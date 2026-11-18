import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/storage/app_database.dart';
import '../../core/sync/webdav_config_store.dart';
import '../../core/sync/webdav_sync.dart';
import '../../core/sync/webdav_transport.dart';
import 'sync_provider.dart';

class WebDavSavedConfig {
  const WebDavSavedConfig({
    required this.url,
    required this.username,
    required this.allowInsecureHttp,
    required this.hasPassword,
  });

  final String url;
  final String username;
  final bool allowInsecureHttp;
  final bool hasPassword;
}

class WebDavConfigInput {
  const WebDavConfigInput({
    required this.url,
    required this.username,
    required this.password,
    required this.allowInsecureHttp,
  });

  final String url;
  final String username;
  final String? password;
  final bool allowInsecureHttp;
}

class WebDavSyncStatus {
  const WebDavSyncStatus({
    this.lastSuccessAt,
    this.pendingLocalChanges = 0,
    this.warnings = const [],
  });

  final DateTime? lastSuccessAt;
  final int pendingLocalChanges;
  final List<String> warnings;
}

abstract class WebDavSyncGateway {
  Future<WebDavSavedConfig?> loadConfig();
  Future<WebDavSyncStatus> loadStatus();
  Future<void> saveConfig(WebDavConfigInput input);
  Future<void> testConnection(WebDavConfigInput input);
  Future<WebDavSyncStatus> syncNow();
  Future<void> clearConfig();
}

typedef WebDavTransportFactory = WebDavTransport Function(WebDavConfig config);

WebDavTransport _defaultTransport(WebDavConfig config) => WebDavTransport(config);

class SecureWebDavSyncGateway implements WebDavSyncGateway {
  SecureWebDavSyncGateway({
    required AppDatabase database,
    WebDavConfigStore? store,
    WebDavTransportFactory transportFactory = _defaultTransport,
  })  : _database = database,
        _store = store ?? WebDavConfigStore(),
        _transportFactory = transportFactory;

  final AppDatabase _database;
  final WebDavConfigStore _store;
  final WebDavTransportFactory _transportFactory;
  bool _running = false;

  @override
  Future<WebDavSavedConfig?> loadConfig() async {
    final stored = await _store.load();
    if (stored == null) return null;
    return WebDavSavedConfig(
      url: stored.url,
      username: stored.username,
      allowInsecureHttp: stored.allowInsecureHttp,
      hasPassword: stored.password.isNotEmpty,
    );
  }

  @override
  Future<WebDavSyncStatus> loadStatus() async {
    final device = await _database.getSyncDevice();
    return WebDavSyncStatus(
      lastSuccessAt: device.lastSuccessAt,
      pendingLocalChanges: device.counter > device.publishedCounter ? 1 : 0,
    );
  }

  @override
  Future<void> saveConfig(WebDavConfigInput input) async {
    await _store.save(await _resolve(input));
  }

  @override
  Future<void> testConnection(WebDavConfigInput input) {
    return _exclusive(() async {
      final config = await _resolve(input);
      final warnings = await _withTransport(config, testWebDavConnection);
      if (warnings.isNotEmpty) {
        throw WebDavSyncException('连接可用，但${warnings.first}，请手动删除该目录');
      }
    });
  }

  @override
  Future<WebDavSyncStatus> syncNow() {
    return _exclusive(() async {
      final config = await _store.load();
      if (config == null) throw const WebDavFormException('请先保存 WebDAV 配置');
      final result = await _withTransport(config, (dav) => syncWebDav(_database, dav));
      return WebDavSyncStatus(
        lastSuccessAt: result.lastSuccessAt,
        pendingLocalChanges: result.pendingChanges ? 1 : 0,
        warnings: result.warnings,
      );
    });
  }

  @override
  Future<void> clearConfig() => _store.clear();

  Future<StoredWebDavConfig> _resolve(WebDavConfigInput input) async {
    var password = input.password;
    if (password == null || password.isEmpty) {
      final saved = await _store.load();
      if (saved == null ||
          normalizeWebDavUrl(saved.url) != input.url ||
          saved.username != input.username) {
        throw const WebDavFormException('更换地址或账号后必须重新填写密码');
      }
      password = saved.password;
    }
    return StoredWebDavConfig(
      url: input.url,
      username: input.username,
      password: password,
      allowInsecureHttp: input.allowInsecureHttp,
    );
  }

  Future<T> _withTransport<T>(
    StoredWebDavConfig stored,
    Future<T> Function(WebDavTransport dav) action,
  ) async {
    WebDavTransport? dav;
    try {
      dav = _transportFactory(WebDavConfig(
        url: stored.url,
        username: stored.username,
        password: stored.password,
        allowInsecureHttp: stored.allowInsecureHttp,
      ));
      return await action(dav);
    } on WebDavFormException {
      rethrow;
    } catch (error) {
      throw WebDavSyncException(sanitizeWebDavError(error, secrets: [stored.password]));
    } finally {
      dav?.dispose();
    }
  }

  Future<T> _exclusive<T>(Future<T> Function() action) async {
    if (_running) throw const WebDavSyncException('已有 WebDAV 任务正在进行');
    _running = true;
    try {
      return await action();
    } finally {
      _running = false;
    }
  }
}

final webDavGatewayProvider = Provider<WebDavSyncGateway>(
  (ref) => SecureWebDavSyncGateway(database: ref.watch(databaseProvider)),
);

enum WebDavBusy { none, loading, saving, testing, syncing, clearing }

class WebDavSettingsState {
  const WebDavSettingsState({
    this.loaded = false,
    this.busy = WebDavBusy.none,
    this.saved,
    this.status = const WebDavSyncStatus(),
    this.notice,
    this.error,
  });

  final bool loaded;
  final WebDavBusy busy;
  final WebDavSavedConfig? saved;
  final WebDavSyncStatus status;
  final String? notice;
  final String? error;

  bool get isBusy => busy != WebDavBusy.none;

  WebDavSettingsState copyWith({
    bool? loaded,
    WebDavBusy? busy,
    WebDavSavedConfig? saved,
    bool clearSaved = false,
    WebDavSyncStatus? status,
    String? notice,
    String? error,
  }) {
    return WebDavSettingsState(
      loaded: loaded ?? this.loaded,
      busy: busy ?? this.busy,
      saved: clearSaved ? null : (saved ?? this.saved),
      status: status ?? this.status,
      notice: notice,
      error: error,
    );
  }
}

class WebDavFormException implements Exception {
  const WebDavFormException(this.message);

  final String message;

  @override
  String toString() => message;
}

const int _maxErrorLength = 200;

String normalizeWebDavUrl(String raw) {
  final trimmed = raw.trim();
  return trimmed.endsWith('/') ? trimmed.substring(0, trimmed.length - 1) : trimmed;
}

WebDavConfigInput resolveWebDavForm({
  required String url,
  required String username,
  required String password,
  required bool allowInsecureHttp,
  required WebDavSavedConfig? saved,
}) {
  final normalizedUrl = normalizeWebDavUrl(url);
  final trimmedUser = username.trim();
  final uri = Uri.tryParse(normalizedUrl);
  if (normalizedUrl.isEmpty || uri == null || !uri.hasScheme || uri.host.isEmpty) {
    throw const WebDavFormException('请填写完整的 WebDAV 地址，例如 https://dav.example.com/dav');
  }
  if (uri.userInfo.isNotEmpty) {
    throw const WebDavFormException('地址中不要包含账号或密码，请填写到下方输入框');
  }
  if (uri.hasQuery || uri.hasFragment) {
    throw const WebDavFormException('WebDAV 地址不能包含 ? 或 # 参数');
  }
  final scheme = uri.scheme.toLowerCase();
  if (scheme == 'http') {
    if (!allowInsecureHttp) {
      throw const WebDavFormException('默认只允许 HTTPS。如确需 HTTP，请先打开“允许不安全的 HTTP”');
    }
  } else if (scheme != 'https') {
    throw const WebDavFormException('仅支持 https:// 或 http:// 地址');
  }
  if (trimmedUser.isEmpty) {
    throw const WebDavFormException('请填写 WebDAV 用户名');
  }
  if (password.isNotEmpty) {
    return WebDavConfigInput(
      url: normalizedUrl,
      username: trimmedUser,
      password: password,
      allowInsecureHttp: allowInsecureHttp,
    );
  }
  final sameIdentity = saved != null &&
      saved.hasPassword &&
      normalizeWebDavUrl(saved.url) == normalizedUrl &&
      saved.username == trimmedUser;
  if (!sameIdentity) {
    throw WebDavFormException(
      saved != null && saved.hasPassword ? '更换地址或账号后必须重新填写密码' : '请填写 WebDAV 密码',
    );
  }
  return WebDavConfigInput(
    url: normalizedUrl,
    username: trimmedUser,
    password: null,
    allowInsecureHttp: allowInsecureHttp,
  );
}

String sanitizeWebDavError(Object error, {List<String> secrets = const []}) {
  if (error is WebDavFormException) return error.message;
  var text = error.toString();
  for (final secret in secrets) {
    if (secret.isNotEmpty) text = text.replaceAll(secret, '***');
  }
  text = text
      .replaceAllMapped(
        RegExp(r'(authorization\s*[:=]\s*)[^\n]+', caseSensitive: false),
        (m) => '${m[1]}***',
      )
      .replaceAllMapped(
        RegExp(r'\b(Basic|Bearer|Digest)\s+[^\s,;]+', caseSensitive: false),
        (m) => '${m[1]} ***',
      )
      .replaceAllMapped(
        RegExp(r'((?:password|passwd|pwd)\s*[:=]\s*)[^\s,;&]+', caseSensitive: false),
        (m) => '${m[1]}***',
      )
      .replaceAll(RegExp(r'://[^/\s@]+@'), '://***@')
      .replaceAll(RegExp(r'^(Exception|Error):\s*'), '')
      .trim();
  if (text.isEmpty) return '操作失败，请检查网络与 WebDAV 配置';
  if (text.length > _maxErrorLength) return '${text.substring(0, _maxErrorLength)}…';
  return text;
}

class WebDavSettingsController extends Notifier<WebDavSettingsState> {
  @override
  WebDavSettingsState build() => const WebDavSettingsState();

  WebDavSyncGateway get _gateway => ref.read(webDavGatewayProvider);

  Future<bool> load() {
    return _run(WebDavBusy.loading, (_) async {
      final saved = await _gateway.loadConfig();
      final status = await _gateway.loadStatus();
      state = state.copyWith(
        loaded: true,
        busy: WebDavBusy.loading,
        saved: saved,
        clearSaved: saved == null,
        status: status,
      );
      return null;
    });
  }

  Future<bool> save(WebDavConfigInput Function(WebDavSavedConfig? saved) resolve) {
    return _run(WebDavBusy.saving, (secrets) async {
      final input = resolve(state.saved);
      secrets.add(input.password ?? '');
      await _gateway.saveConfig(input);
      final saved = await _gateway.loadConfig();
      state = state.copyWith(busy: WebDavBusy.saving, saved: saved, clearSaved: saved == null);
      return '已保存到本机安全存储（密码不会上传到 WebDAV）';
    });
  }

  Future<bool> testConnection(WebDavConfigInput Function(WebDavSavedConfig? saved) resolve) {
    return _run(WebDavBusy.testing, (secrets) async {
      final input = resolve(state.saved);
      secrets.add(input.password ?? '');
      await _gateway.testConnection(input);
      return '连接成功，WebDAV 地址与账号可用（尚未保存则不会生效）';
    });
  }

  Future<bool> syncNow() {
    return _run(WebDavBusy.syncing, (_) async {
      if (state.saved == null) {
        throw const WebDavFormException('请先保存 WebDAV 配置');
      }
      final status = await _gateway.syncNow();
      state = state.copyWith(busy: WebDavBusy.syncing, status: status);
      return status.pendingLocalChanges > 0 || status.warnings.isNotEmpty
          ? '同步已完成，但仍有需要注意的项目'
          : '同步完成，本机变更均已上传';
    });
  }

  Future<bool> clearConfig() {
    return _run(WebDavBusy.clearing, (_) async {
      await _gateway.clearConfig();
      state = state.copyWith(busy: WebDavBusy.clearing, clearSaved: true);
      return '已清除本机保存的 WebDAV 地址与凭据；本地收藏/进度与远端文件均未删除';
    });
  }

  Future<bool> _run(
    WebDavBusy busy,
    Future<String?> Function(List<String> secrets) action,
  ) async {
    if (state.isBusy) return false;
    state = state.copyWith(busy: busy);
    final secrets = <String>[];
    try {
      final notice = await action(secrets);
      state = state.copyWith(busy: WebDavBusy.none, notice: notice);
      return true;
    } catch (error) {
      state = state.copyWith(
        loaded: true,
        busy: WebDavBusy.none,
        error: sanitizeWebDavError(error, secrets: secrets),
      );
      return false;
    }
  }
}

final webDavSettingsProvider =
    NotifierProvider<WebDavSettingsController, WebDavSettingsState>(
  WebDavSettingsController.new,
);
