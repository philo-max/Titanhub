import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'venera_convert.dart';
import 'venera_cookies.dart';
import 'venera_html.dart';
import 'venera_models.dart';

class VeneraLimits {
  const VeneraLimits({
    this.callTimeout = const Duration(seconds: 60),
    this.maxRequests = 300,
    this.requestTimeout = const Duration(seconds: 15),
    this.maxResponseBytes = 5 * 1024 * 1024,
    this.maxTotalBytes = 48 * 1024 * 1024,
    this.maxTimers = 200,
    this.maxDelay = const Duration(seconds: 10),
    this.maxLogs = 50,
  });

  final Duration callTimeout;
  final int maxRequests;
  final Duration requestTimeout;
  final int maxResponseBytes;
  final int maxTotalBytes;
  final int maxTimers;
  final Duration maxDelay;
  final int maxLogs;
}

typedef VeneraSettle = void Function(String id, String json);
typedef VeneraPersist = Future<void> Function(Map<String, dynamic> data, VeneraCookieJar cookies);

const String veneraNeutralUserAgent = 'Titanhub/1.1 (mobile)';

const Set<String> veneraNeutralUserAgentHosts = {'api.mangadex.org'};

const String veneraUserAgent =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

class VeneraHttpDiagnostic {
  const VeneraHttpDiagnostic({
    required this.status,
    required this.path,
    required this.body,
    required this.headerNames,
    this.serverMessage,
  });

  final int status;
  final String path;
  final String body;
  final List<String> headerNames;
  final String? serverMessage;

  static bool isSuccessStatus(int status) => status >= 200 && status <= 209;

  bool get isFailure => !isSuccessStatus(status);

  String format() {
    final parts = <String>['HTTP $status $path'];
    if (serverMessage != null && serverMessage!.isNotEmpty) parts.add('服务端消息：$serverMessage');
    if (body.isNotEmpty) parts.add('响应体：$body');
    parts.add('已发送请求头：${headerNames.join(', ')}');
    return parts.join('；');
  }

  static const int bodyLimit = 200;

  static final RegExp _bearer = RegExp(r'Bearer\s+[A-Za-z0-9\-._~+/]+=*', caseSensitive: false);
  static final RegExp _secretPair = RegExp(
    r'''("?(?:access_?token|refresh_?token|token|authorization|set-cookie|cookie|password|passwd|secret|session_?id|sessionid)"?\s*[:=]\s*)("[^"]*"|[^\s,;&}]+)''',
    caseSensitive: false,
  );

  static String redact(String text) =>
      text.replaceAll(_bearer, 'Bearer ***').replaceAllMapped(_secretPair, (m) => '${m[1]}***');

  static VeneraHttpDiagnostic build({
    required int status,
    required Uri uri,
    required List<int> bytes,
    required Iterable<String> headerNames,
  }) {
    final text = utf8.decode(bytes.length > 4096 ? bytes.sublist(0, 4096) : bytes, allowMalformed: true);
    String? message;
    if (!isSuccessStatus(status)) {
      try {
        final decoded = jsonDecode(utf8.decode(bytes, allowMalformed: true));
        if (decoded is Map) {
          for (final key in const ['message', 'msg', 'detail']) {
            final value = decoded[key];
            if (value is String && value.isNotEmpty) {
              message = redact(value);
              break;
            }
          }
        }
      } catch (_) {}
    }
    final redacted = redact(text.replaceAll(RegExp(r'\s+'), ' ').trim());
    return VeneraHttpDiagnostic(
      status: status,
      path: uri.path.isEmpty ? '/' : uri.path,
      body: redacted.length > bodyLimit ? redacted.substring(0, bodyLimit) : redacted,
      headerNames: headerNames.toList(),
      serverMessage: message,
    );
  }
}

class VeneraHost {
  VeneraHost({
    required this.settle,
    required this.persist,
    Map<String, dynamic>? data,
    VeneraCookieJar? cookies,
    this.limits = const VeneraLimits(),
    Dio? dio,
  })  : data = data ?? {},
        cookies = cookies ?? VeneraCookieJar(),
        _dio = dio ??
            Dio(BaseOptions(
              connectTimeout: limits.requestTimeout,
              receiveTimeout: limits.requestTimeout,
              sendTimeout: limits.requestTimeout,
              followRedirects: true,
              maxRedirects: 5,
              validateStatus: (_) => true,
            ));

  final VeneraSettle settle;
  final VeneraPersist persist;
  final Map<String, dynamic> data;
  final VeneraCookieJar cookies;
  final VeneraLimits limits;
  final Dio _dio;
  final VeneraHtmlRegistry html = VeneraHtmlRegistry();
  final List<String> logs = [];
  final List<String> messages = [];
  final Set<Timer> _timers = {};
  CancelToken _cancel = CancelToken();
  int requestCount = 0;
  int totalBytes = 0;
  int timerCount = 0;
  bool _closed = false;
  VeneraHttpDiagnostic? lastResponse;
  VeneraHttpDiagnostic? lastFailure;

  void resetBudget() {
    requestCount = 0;
    totalBytes = 0;
    timerCount = 0;
    lastResponse = null;
    lastFailure = null;
    _cancel = CancelToken();
  }

  void cancelPending() {
    if (!_cancel.isCancelled) _cancel.cancel('已取消');
    for (final timer in _timers.toList()) {
      timer.cancel();
    }
    _timers.clear();
  }

  void close() {
    _closed = true;
    cancelPending();
    html.clear();
    _dio.close(force: true);
  }

  String handle(String raw) {
    try {
      final message = jsonDecode(raw) as Map;
      final method = message['m'] as String;
      final payload = Map<String, dynamic>.from(message['p'] as Map? ?? const {});
      final id = message['id'] as String?;
      return jsonEncode({'ok': true, 'v': _dispatch(method, payload, id)});
    } catch (error) {
      return jsonEncode({'ok': false, 'e': '$error'});
    }
  }

  Object? _dispatch(String method, Map<String, dynamic> p, String? id) {
    switch (method) {
      case 'convert':
        return veneraConvert(p);
      case 'html':
        return html.handle('${p['fn']}', p);
      case 'uuid':
        return _uuid();
      case 'load_data':
        return data['${p['key']}'];
      case 'save_data':
        if (p['key'] == 'setting') throw const VeneraException('setting 不允许通过 saveData 写入');
        data['${p['key']}'] = p['data'];
        _persist();
        return null;
      case 'delete_data':
        data.remove('${p['key']}');
        _persist();
        return null;
      case 'load_setting':
        final settings = data['settings'];
        final has = settings is Map && settings.containsKey('${p['key']}');
        return {'has': has, 'value': has ? settings['${p['key']}'] : null};
      case 'isLogged':
        return data['account'] != null;
      case 'cookie':
        return _cookie(p);
      case 'log':
        if (logs.length < limits.maxLogs) logs.add('${p['level']}: ${p['text']}');
        return null;
      case 'ui':
        if (messages.length < limits.maxLogs) messages.add('${p['text']}');
        return null;
      case 'delay':
        _delay(id!, p);
        return null;
      case 'http':
        unawaited(_http(id!, p));
        return null;
    }
    throw VeneraException('需要宿主能力：$method');
  }

  void _persist() {
    if (_closed) return;
    unawaited(persist(data, cookies).catchError((_) {}));
  }

  static final Random _random = Random.secure();

  String _uuid() {
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    String hex(int from, int to) => bytes.sublist(from, to).map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex(0, 4)}-${hex(4, 6)}-${hex(6, 8)}-${hex(8, 10)}-${hex(10, 16)}';
  }

  Object? _cookie(Map<String, dynamic> p) {
    final uri = Uri.parse('${p['url']}');
    if (!uri.hasScheme || uri.host.isEmpty) throw const VeneraException('Cookie 地址无效');
    switch (p['fn']) {
      case 'set':
        cookies.setForUri(uri, [for (final c in (p['cookies'] as List? ?? const [])) if (c is Map) c]);
        _persist();
        return null;
      case 'get':
        return [for (final c in cookies.forUri(uri)) c.toScript()];
      case 'delete':
        cookies.deleteForUri(uri);
        _persist();
        return null;
    }
    throw const VeneraException('Cookie 操作无效');
  }

  void _delay(String id, Map<String, dynamic> p) {
    if (++timerCount > limits.maxTimers) throw const VeneraException('超过定时器次数上限');
    final ms = ((p['ms'] as num?) ?? 0).toInt().clamp(0, limits.maxDelay.inMilliseconds);
    late final Timer timer;
    timer = Timer(Duration(milliseconds: ms), () {
      _timers.remove(timer);
      if (!_closed) settle(id, jsonEncode({'ok': true, 'v': null}));
    });
    _timers.add(timer);
  }

  static bool isBlockedHost(String host) {
    final h = host.toLowerCase();
    if (h == 'localhost' || h.endsWith('.localhost') || h == '0.0.0.0' || h == '::' || h == '::1' || h == '[::1]') {
      return true;
    }
    return RegExp(r'^127\.').hasMatch(h) || RegExp(r'^169\.254\.').hasMatch(h);
  }

  Uri checkUrl(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https') || uri.host.isEmpty) {
      throw VeneraException('请求地址不合法：只允许 http/https');
    }
    if (isBlockedHost(uri.host)) throw const VeneraException('请求地址被禁止：本机回环/链路本地地址');
    return uri;
  }

  Future<void> _http(String id, Map<String, dynamic> p) async {
    String reply(Object? value, {bool ok = true}) =>
        jsonEncode(ok ? {'ok': true, 'v': value} : {'ok': false, 'e': '$value'});
    try {
      if (++requestCount > limits.maxRequests) {
        throw VeneraException('超过单次调用请求数上限（${limits.maxRequests}）');
      }
      final uri = checkUrl('${p['url']}');
      final headers = <String, dynamic>{
        for (final e in Map<String, dynamic>.from(p['headers'] as Map? ?? const {}).entries)
          if (e.key.toLowerCase() != 'http_client' &&
              e.key.toLowerCase() != 'accept-encoding')
            e.key: '${e.value}',
      };
      final lower = {for (final k in headers.keys) k.toLowerCase(): k};
      if (!lower.containsKey('user-agent')) {
        headers['User-Agent'] = veneraNeutralUserAgentHosts.contains(uri.host) ? veneraNeutralUserAgent : veneraUserAgent;
      }
      final jarCookie = cookies.headerFor(uri);
      if (jarCookie != null) {
        final existing = lower['cookie'];
        headers[existing ?? 'Cookie'] = existing == null ? jarCookie : '${headers[existing]}; $jarCookie';
      }
      final body = p['body'] as Map?;
      Object? payload;
      if (body != null) {
        switch (body['kind']) {
          case 'text':
            payload = body['value'];
          case 'json':
            payload = jsonEncode(body['value']);
            if (!lower.containsKey('content-type')) headers['Content-Type'] = 'application/json';
          case 'bytes':
            payload = Uint8List.fromList(base64Decode('${body['value']}'));
        }
      }
      final response = await _dio.request<ResponseBody>(
        uri.toString(),
        data: payload,
        cancelToken: _cancel,
        options: Options(method: '${p['method']}'.toUpperCase(), headers: headers, responseType: ResponseType.stream),
      );
      final bytes = await _readBody(response);
      final diagnostic = VeneraHttpDiagnostic.build(
        status: response.statusCode ?? 0,
        uri: uri,
        bytes: bytes,
        headerNames: headers.keys,
      );
      lastResponse = diagnostic;
      if (diagnostic.isFailure) lastFailure = diagnostic;
      final setCookies = response.headers.map['set-cookie'];
      if (setCookies != null && setCookies.isNotEmpty) {
        cookies.storeFromResponse(response.realUri, setCookies);
        _persist();
      }
      final responseHeaders = <String, String>{
        for (final e in response.headers.map.entries) e.key.toLowerCase(): e.value.join(','),
      };
      final asBytes = p['bytes'] == true;
      if (!_closed) {
        settle(id, reply({
          'status': response.statusCode ?? 0,
          'headers': responseHeaders,
          'body': asBytes ? base64Encode(bytes) : utf8.decode(bytes, allowMalformed: true),
        }));
      }
    } on DioException catch (error) {
      if (!_closed) settle(id, reply(_describe(error), ok: false));
    } catch (error) {
      if (!_closed) settle(id, reply(error, ok: false));
    }
  }

  Future<List<int>> _readBody(Response<ResponseBody> response) async {
    final stream = response.data;
    if (stream == null) return const [];
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in stream.stream.timeout(limits.requestTimeout)) {
      bytes.add(chunk);
      totalBytes += chunk.length;
      if (bytes.length > limits.maxResponseBytes) {
        throw const VeneraException('响应超过单个大小上限');
      }
      if (totalBytes > limits.maxTotalBytes) {
        throw const VeneraException('响应累计超过单次调用大小上限');
      }
    }
    return bytes.takeBytes();
  }

  String _describe(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.receiveTimeout:
      case DioExceptionType.sendTimeout:
        return '网络请求超时';
      case DioExceptionType.cancel:
        return '请求已取消';
      case DioExceptionType.connectionError:
        return '网络不可达';
      default:
        final cause = error.error;
        final detail = cause == null ? (error.message ?? error.type.name) : cause.runtimeType.toString();
        return '网络请求失败：$detail';
    }
  }
}
