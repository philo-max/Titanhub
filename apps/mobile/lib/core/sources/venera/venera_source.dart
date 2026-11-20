import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

import '../../sync/webdav_config_store.dart';
import 'venera_cookies.dart';
import 'venera_engine.dart';
import 'venera_host.dart';
import 'venera_image_proxy.dart';
import 'venera_models.dart';
import 'venera_policy.dart';
import 'venera_store.dart';

const int veneraMaxImageHeaderEntries = 5000;
const int veneraInfoCacheMaxEntries = 50;
const Duration veneraInfoCacheTtl = Duration(minutes: 2);

class _InfoCacheEntry {
  _InfoCacheEntry(this.future, this.expiresAt);

  final Future<Map> future;
  final DateTime expiresAt;
}

class VeneraSettingOption {
  const VeneraSettingOption({required this.value, required this.text});

  final String value;
  final String text;
}

class VeneraSettingItem {
  const VeneraSettingItem({
    required this.key,
    required this.title,
    required this.type,
    required this.defaultValue,
    required this.value,
    this.options,
  });

  final String key;
  final String title;
  final String type;
  final Object? defaultValue;
  final Object? value;
  final List<VeneraSettingOption>? options;
}

class VeneraSourceInfo {
  const VeneraSourceInfo({
    required this.hasSearch,
    required this.exploreTitles,
    required this.settings,
    required this.canPasswordLogin,
    required this.hasWebLogin,
    required this.hasCookieLogin,
    required this.isLogged,
    required this.registerWebsite,
  });

  final bool hasSearch;
  final List<String> exploreTitles;
  final List<VeneraSettingItem> settings;
  final bool canPasswordLogin;
  final bool hasWebLogin;
  final bool hasCookieLogin;
  final bool isLogged;
  final String registerWebsite;
}

class VeneraSource {
  VeneraSource(
    this.meta,
    this.code, {
    required this.store,
    this.limits = const VeneraLimits(),
    this.runtimeFactory = createVeneraRuntime,
    this.dio,
    this.secrets,
    DateTime Function()? clock,
    this.infoCacheTtl = veneraInfoCacheTtl,
    this.infoCacheMaxEntries = veneraInfoCacheMaxEntries,
  }) : _clock = clock ?? DateTime.now;

  final InstalledVeneraSource meta;
  final String code;
  final VeneraStore store;
  final VeneraLimits limits;
  final VeneraRuntimeFactory runtimeFactory;
  final Dio? dio;
  final SecureKeyValue? secrets;
  final DateTime Function() _clock;
  final Duration infoCacheTtl;
  final int infoCacheMaxEntries;
  final Map<String, _InfoCacheEntry> _infoCache = {};
  final Map<String, Map<String, String>> _imageHeaders = {};
  Future<VeneraEngine>? _engineFuture;
  Future<void> _persistTail = Future.value();
  bool _disposed = false;

  String get id => meta.id;

  Future<VeneraEngine> _engine() {
    final existing = _engineFuture;
    if (existing != null) {
      return existing.then((engine) {
        if (engine.isUsable) return engine;
        _engineFuture = null;
        return _engine();
      });
    }
    return _engineFuture = _create();
  }

  Future<VeneraEngine> _create() async {
    try {
      final data = await store.readJsonMap(store.dataFile(id));
      final legacyAccount = data['account'];
      final secret = await _readAccountSecret();
      if (secret != null) {
        data['account'] = secret;
      } else if (legacyAccount is! List) {
        data.remove('account');
      }
      final cookieJson = await store.readJsonMap(store.cookieFile(id));
      final jar = VeneraCookieJar([
        for (final item in (cookieJson['cookies'] as List? ?? const []))
          if (item is Map) VeneraCookie.fromJson(item),
      ]);
      final engine = await VeneraEngine.create(
        code: code,
        data: data,
        cookies: jar,
        limits: limits,
        runtimeFactory: runtimeFactory,
        dio: dio,
        persist: _persist,
      );
      if (secret == null && legacyAccount is List) {
        await _persist(engine.host.data, engine.host.cookies);
      }
      return engine;
    } catch (_) {
      _engineFuture = null;
      rethrow;
    }
  }

  Future<Object?> _readAccountSecret() async {
    final raw = await secrets?.read(veneraAccountSecretKey(id));
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      return decoded is List ? decoded : null;
    } on FormatException {
      return null;
    }
  }

  Future<void> _persist(Map<String, dynamic> data, VeneraCookieJar cookies) {
    final next = _persistTail.catchError((_) {}).then((_) => _write(data, cookies));
    _persistTail = next;
    return next;
  }

  Future<void> _write(Map<String, dynamic> data, VeneraCookieJar cookies) async {
    if (_disposed) return;
    final account = data['account'];
    final vault = secrets;
    if (vault != null) {
      if (account is List) {
        await vault.write(veneraAccountSecretKey(id), jsonEncode(account));
      } else {
        await vault.delete(veneraAccountSecretKey(id));
      }
    }
    final plain = Map<String, dynamic>.from(data)..remove('account');
    await store.writeJsonMap(store.dataFile(id), plain);
    await store.writeJsonMap(store.cookieFile(id), {
      'cookies': [for (final c in cookies.all) c.toJson()],
    });
  }

  Future<Object?> _call(String method, [List<Object?> args = const []]) async {
    final engine = await _engine();
    try {
      return await engine.call(method, args);
    } on VeneraSourceException catch (error) {
      throw VeneraException(_explain(error));
    }
  }

  String _explain(VeneraSourceException error) {
    if (error.message.contains('需要宿主能力')) return error.message;
    final status = error.httpStatus;
    if (status == 401 || status == 403 || error.loginSignal) return _withConfigHint(error.message);
    if (status != null || error.businessSignal) return '来源接口返回：${error.message}';
    return error.message;
  }

  String _withConfigHint(String message) {
    if (!meta.hints.needsConfig) return message;
    return '$message（该来源可能需要先配置域名/账号登录）';
  }

  Future<Map> _info(String comicId) {
    final now = _clock();
    _infoCache.removeWhere((_, entry) => !entry.expiresAt.isAfter(now));
    final cached = _infoCache[comicId];
    if (cached != null) return cached.future;
    final future = _call('info', [comicId]).then((value) => value as Map);
    if (_infoCache.length >= infoCacheMaxEntries) _infoCache.remove(_infoCache.keys.first);
    final entry = _InfoCacheEntry(future, now.add(infoCacheTtl));
    _infoCache[comicId] = entry;
    future.then((_) {}, onError: (_) {
      if (identical(_infoCache[comicId], entry)) _infoCache.remove(comicId);
    });
    return future;
  }

  static List<dynamic> _list(Object? value) => value is List ? value : const [];

  Future<dynamic> call(String method, List<dynamic> args) async {
    switch (method) {
      case 'search':
        final keyword = args.isEmpty ? '' : '${args.first}'.trim();
        if (keyword.isEmpty) return const [];
        final result = await _call('searchPage', [keyword, 1]) as Map;
        return _list(result['comics']);
      case 'explore':
        final tab = args.isNotEmpty && args.first != null ? ['${args.first}'] : const <Object?>[];
        final result = await _call('explore', tab) as Map;
        return _list(result['comics']);
      case 'getDetail':
        return (await _info('${args.first}'))['detail'];
      case 'getChapters':
        return _list((await _info('${args.first}'))['chapters']);
      case 'getImages':
        return await _images('${args.first}');
    }
    throw VeneraException('漫画来源不支持方法：$method');
  }

  Future<List<String>> _images(String chapterId) async {
    final separator = chapterId.indexOf('::');
    final comicId = separator >= 0 ? chapterId.substring(0, separator) : chapterId;
    final epId = separator >= 0 ? chapterId.substring(separator + 2) : '';
    final engine = await _engine();
    final raw = _list(await _call('images', [comicId, epId]));
    final urls = <String>[];
    for (final item in raw) {
      if (item is! Map) continue;
      final url = '${item['url']}';
      final headers = <String, String>{
        'User-Agent': veneraUserAgent,
        for (final e in (item['headers'] as Map? ?? const {}).entries) '${e.key}': '${e.value}',
      };
      final uri = Uri.tryParse(url);
      if (uri != null && uri.hasScheme && !headers.keys.any((k) => k.toLowerCase() == 'cookie')) {
        final cookie = engine.host.cookies.headerFor(uri);
        if (cookie != null) headers['Cookie'] = cookie;
      }
      final modifyScript = item['modifyImage']?.toString() ?? '';
      if (modifyScript.isNotEmpty) {
        final proxyUrl = await VeneraImageProxy.instance.register(
          url: url,
          headers: headers,
          modifyImageScript: modifyScript,
        );
        urls.add(proxyUrl);
      } else {
        if (_imageHeaders.length >= veneraMaxImageHeaderEntries) _imageHeaders.remove(_imageHeaders.keys.first);
        _imageHeaders[url] = headers;
        urls.add(url);
      }
    }
    if (urls.isEmpty) throw const VeneraException('来源没有返回任何图片');
    return urls;
  }

  Future<List<String>> recentLogs() async => List.unmodifiable((await _engine()).host.logs);

  Map<String, String>? imageHeaders(String url) => _imageHeaders[url];

  Future<VeneraSourceInfo> info() async {
    final raw = await _call('describe') as Map;
    final engine = await _engine();
    final stored = engine.host.data['settings'];
    final account = raw['account'] as Map?;
    return VeneraSourceInfo(
      hasSearch: raw['hasSearch'] == true,
      exploreTitles: [for (final p in _list(raw['explore'])) '${(p as Map)['title']}'],
      settings: [
        for (final s in _list(raw['settings']).cast<Map>())
          VeneraSettingItem(
            key: '${s['key']}',
            title: '${s['title']}',
            type: '${s['type']}',
            defaultValue: s['default'],
            value: stored is Map && stored.containsKey(s['key']) ? stored['${s['key']}'] : s['default'],
            options: s['options'] is List
                ? [
                    for (final o in (s['options'] as List).cast<Map>())
                      VeneraSettingOption(value: '${o['value']}', text: '${o['text']}'),
                  ]
                : null,
          ),
      ],
      canPasswordLogin: account?['login'] == true,
      hasWebLogin: account?['webLogin'] == true,
      hasCookieLogin: account?['cookieLogin'] == true,
      isLogged: raw['isLogged'] == true,
      registerWebsite: account == null ? '' : '${account['registerWebsite']}',
    );
  }

  Future<void> saveSetting(String key, Object? value) async {
    final engine = await _engine();
    final settings = engine.host.data.putIfAbsent('settings', () => <String, dynamic>{});
    if (settings is! Map) throw const VeneraException('来源设置数据已损坏');
    settings[key] = value;
    _infoCache.clear();
    await engine.host.persist(engine.host.data, engine.host.cookies);
  }

  Future<void> login(String account, String password) async {
    _infoCache.clear();
    await _call('login', [account, password]);
    final engine = await _engine();
    engine.host.data['account'] = [account, password];
    await engine.host.persist(engine.host.data, engine.host.cookies);
  }

  Future<void> logout() async {
    _infoCache.clear();
    final engine = await _engine();
    try {
      await _call('logout');
    } finally {
      engine.host.data.remove('account');
      engine.host.cookies.clear();
      await engine.host.persist(engine.host.data, engine.host.cookies);
    }
  }

  Future<void> cancel() async {
    final future = _engineFuture;
    if (future == null) return;
    _engineFuture = null;
    try {
      (await future).cancel();
    } catch (_) {}
  }

  void dispose() {
    _disposed = true;
    final future = _engineFuture;
    _engineFuture = null;
    future?.then((engine) => engine.dispose(), onError: (_) {});
  }
}
