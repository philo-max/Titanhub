import 'dart:async';
import 'dart:convert';
import 'package:flutter_js/flutter_js.dart';
import 'package:dio/dio.dart';
import 'package:html/parser.dart' as parser;

class JsEngine {
  static final RegExp _methodNamePattern = RegExp(r'^[A-Za-z_$][A-Za-z0-9_$]*$');

  static const String runtimeBootstrap = r'''
      globalThis._reqSeq = 0;
      globalThis._pendingRequests = {};

      function _fmtArg(value) {
        if (typeof value === 'string') return value;
        try {
          const encoded = JSON.stringify(value);
          return encoded === undefined ? String(value) : encoded;
        } catch (e) {
          return String(value);
        }
      }

      globalThis.console = {
        log: function(...args) {
          sendMessage('log', JSON.stringify(args.map(_fmtArg).join(' ')));
          return '';
        },
        warn: function(...args) {
          sendMessage('log', JSON.stringify('[warn] ' + args.map(_fmtArg).join(' ')));
          return '';
        },
        error: function(...args) {
          sendMessage('error', JSON.stringify(args.map(_fmtArg).join(' ')));
          return '';
        }
      };

      globalThis._resolveRequest = function(reqId, status, body, headersJson) {
        const req = globalThis._pendingRequests[reqId];
        if (!req) return;
        delete globalThis._pendingRequests[reqId];
        let rawHeaders = {};
        try {
          rawHeaders = JSON.parse(headersJson || '{}') || {};
        } catch (e) {
          rawHeaders = {};
        }
        const normalized = {};
        Object.keys(rawHeaders).forEach(function(key) {
          normalized[String(key).toLowerCase()] = String(rawHeaders[key]);
        });
        req.resolve({
          ok: status >= 200 && status < 300,
          status: status,
          url: req.url,
          headers: {
            get: function(name) {
              const key = String(name).toLowerCase();
              return Object.prototype.hasOwnProperty.call(normalized, key) ? normalized[key] : null;
            },
            has: function(name) {
              return Object.prototype.hasOwnProperty.call(normalized, String(name).toLowerCase());
            },
            forEach: function(callback) {
              Object.keys(normalized).forEach(function(key) {
                callback(normalized[key], key);
              });
            }
          },
          text: async function() { return body; },
          json: async function() { return JSON.parse(body); }
        });
      };

      globalThis._rejectRequest = function(reqId, error) {
        const req = globalThis._pendingRequests[reqId];
        if (!req) return;
        delete globalThis._pendingRequests[reqId];
        req.reject(new Error(error));
      };

      globalThis.fetch = function(url, options) {
        const requestOptions = options || {};
        return new Promise(function(resolve, reject) {
          const reqId = 'req_' + (++globalThis._reqSeq) + '_' + Date.now().toString(36);
          globalThis._pendingRequests[reqId] = {
            resolve: resolve,
            reject: reject,
            url: String(url)
          };
          try {
            sendMessage('fetch', JSON.stringify({
              url: String(url),
              options: requestOptions,
              reqId: reqId
            }));
          } catch (e) {
            delete globalThis._pendingRequests[reqId];
            reject(e);
          }
        });
      };

      globalThis.select = function(html, selector) {
        return sendMessage('select', JSON.stringify({ html: html, selector: selector }));
      };

      globalThis.selectOne = function(html, selector) {
        return sendMessage('selectOne', JSON.stringify({ html: html, selector: selector }));
      };

      globalThis.selectText = function(html, selector) {
        return sendMessage('selectText', JSON.stringify({ html: html, selector: selector }));
      };

      globalThis.selectAttribute = function(html, selector, attr) {
        return sendMessage('selectAttribute', JSON.stringify({ html: html, selector: selector, attr: attr }));
      };

      globalThis.htmlParser = {
        select: function(html, selector) { return globalThis.select(html, selector); },
        selectOne: function(html, selector) { return globalThis.selectOne(html, selector); },
        selectText: function(html, selector) { return globalThis.selectText(html, selector); },
        selectAttribute: function(html, selector, attr) {
          return globalThis.selectAttribute(html, selector, attr);
        }
      };
    ''';

  late final JavascriptRuntime _runtime;
  final _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 15),
    validateStatus: (_) => true,
  ));
  final Map<String, Timer> _timeouts = {};
  final Set<String> _pendingRequests = {};
  final Duration callTimeout;
  bool _disposed = false;

  static const Duration _runtimeGracePeriod = Duration(milliseconds: 250);

  JsEngine({this.callTimeout = const Duration(seconds: 60)}) {
    _runtime = getJavascriptRuntime(xhr: false);
    _setupBridge();
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    for (final timer in _timeouts.values) {
      timer.cancel();
    }
    _timeouts.clear();
    _rejectPendingRequests();
    _dio.close(force: true);
    Timer(_runtimeGracePeriod, _releaseRuntime);
  }

  void _releaseRuntime() {
    try {
      _runtime.dispose();
    } catch (_) {}
  }

  void _rejectPendingRequests() {
    final reqIds = _pendingRequests.toList();
    _pendingRequests.clear();
    for (final reqId in reqIds) {
      try {
        _runtime.evaluate(
          'globalThis._rejectRequest(${jsonEncode(reqId)}, ${jsonEncode('引擎已释放')})',
        );
      } catch (_) {}
    }
  }

  void _setupBridge() {
    // 1. Console log
    _runtime.onMessage('log', (dynamic args) {
      print('[JS Log] ${_stringArg(args)}');
      return '';
    });
    _runtime.onMessage('error', (dynamic args) {
      print('[JS Error] ${_stringArg(args)}');
      return '';
    });

    // 2. Fetch
    _runtime.onMessage('fetch', (dynamic args) {
      _handleFetch(args);
      return '';
    });

    // 3. HTML selectors (Cheerio replacements)
    _runtime.onMessage('select', (dynamic args) {
      try {
        final params = _decodeParams(args);
        final document = parser.parse(params['html'] as String? ?? '');
        final selector = params['selector'] as String? ?? '';
        final elements = document.querySelectorAll(selector);
        final list = elements.map(_elementToMap).toList();
        return jsonEncode(list);
      } catch (_) {
        return '[]';
      }
    });

    _runtime.onMessage('selectOne', (dynamic args) {
      try {
        final params = _decodeParams(args);
        final document = parser.parse(params['html'] as String? ?? '');
        final selector = params['selector'] as String? ?? '';
        final element = document.querySelector(selector);
        if (element == null) return 'null';
        return jsonEncode(_elementToMap(element));
      } catch (_) {
        return 'null';
      }
    });

    _runtime.onMessage('selectText', (dynamic args) {
      try {
        final params = _decodeParams(args);
        final document = parser.parse(params['html'] as String? ?? '');
        final selector = params['selector'] as String? ?? '';
        return document.querySelector(selector)?.text.trim() ?? '';
      } catch (_) {
        return '';
      }
    });

    _runtime.onMessage('selectAttribute', (dynamic args) {
      try {
        final params = _decodeParams(args);
        final document = parser.parse(params['html'] as String? ?? '');
        final selector = params['selector'] as String? ?? '';
        final attr = params['attr'] as String? ?? '';
        return document.querySelector(selector)?.attributes[attr] ?? '';
      } catch (_) {
        return '';
      }
    });

    // 4. Inject runtime helper environment JS
    _runtime.evaluate(runtimeBootstrap);
  }

  Map<String, dynamic> _decodeParams(dynamic args) {
    final dynamic raw = args is String ? jsonDecode(args) : args;
    if (raw is Map) return Map<String, dynamic>.from(raw);
    throw const FormatException('invalid bridge payload');
  }

  String _stringArg(dynamic args) {
    if (args == null) return '';
    if (args is String) return args;
    try {
      return jsonEncode(args);
    } catch (_) {
      return args.toString();
    }
  }

  Map<String, dynamic> _elementToMap(dynamic element) {
    final attrs = <String, String>{};
    element.attributes.forEach((key, value) {
      attrs[key.toString()] = value;
    });
    return {
      'text': element.text.trim(),
      'html': element.outerHtml,
      'attrs': attrs,
    };
  }

  void _handleFetch(dynamic args) {
    var reqId = '';
    try {
      final params = _decodeParams(args);
      reqId = params['reqId'] as String? ?? '';
      final url = params['url'] as String? ?? '';
      if (url.isEmpty) {
        throw const FormatException('empty url');
      }
      final options = params['options'] is Map ? params['options'] as Map : const {};
      final method = (options['method'] as String?)?.toUpperCase() ?? 'GET';
      final headers = Map<String, dynamic>.from(options['headers'] as Map? ?? const {});
      final body = options['body'];
      final rawTimeout = (options['timeout'] as num?)?.toInt() ?? 20;
      final timeoutSeconds = rawTimeout < 1 ? 1 : (rawTimeout > 120 ? 120 : rawTimeout);

      _startTimeout(reqId, Duration(seconds: timeoutSeconds));
      _pendingRequests.add(reqId);
      unawaited(_performFetch(reqId, url, method, headers, body));
    } catch (error) {
      if (reqId.isNotEmpty) {
        final message = '网络请求参数无效: $error';
        Future<void>.microtask(() => _reject(reqId, message));
      }
    }
  }

  Future<void> _performFetch(
    String reqId,
    String url,
    String method,
    Map<String, dynamic> headers,
    dynamic body,
  ) async {
    try {
      final response = await _dio.request(
        url,
        options: Options(
          method: method,
          headers: headers,
          responseType: ResponseType.plain,
        ),
        data: body,
      );
      _resolve(reqId, response.statusCode ?? 200, response.data?.toString() ?? '', response.headers.map);
    } catch (error) {
      _reject(reqId, describeNetworkError(error));
    }
  }

  void _startTimeout(String reqId, Duration duration) {
    _cancelTimeout(reqId);
    _timeouts[reqId] = Timer(duration, () {
      _timeouts.remove(reqId);
      _reject(reqId, '网络请求超时（${duration.inSeconds} 秒）');
    });
  }

  void _cancelTimeout(String reqId) {
    _timeouts.remove(reqId)?.cancel();
  }

  void _resolve(String reqId, int status, String body, [Map<String, List<String>>? headers]) {
    _cancelTimeout(reqId);
    _pendingRequests.remove(reqId);
    final headerJson = <String, String>{};
    headers?.forEach((key, value) {
      if (value.isNotEmpty) headerJson[key] = value.join(', ');
    });
    _evaluate(
      'globalThis._resolveRequest(${jsonEncode(reqId)}, $status, ${jsonEncode(body)}, ${jsonEncode(jsonEncode(headerJson))})',
    );
  }

  void _reject(String reqId, String message) {
    _cancelTimeout(reqId);
    _pendingRequests.remove(reqId);
    _evaluate('globalThis._rejectRequest(${jsonEncode(reqId)}, ${jsonEncode(message)})');
  }

  void _evaluate(String code) {
    if (_disposed) return;
    try {
      _runtime.evaluate(_escapeLineSeparators(code));
    } catch (_) {}
  }

  static String _escapeLineSeparators(String code) {
    if (!code.contains('\u2028') && !code.contains('\u2029')) return code;
    return code.replaceAll('\u2028', r'\u2028').replaceAll('\u2029', r'\u2029');
  }

  static String describeNetworkError(Object error) {
    if (error is DioException) {
      final response = error.response;
      final status = response?.statusCode;
      final body = response?.data?.toString().trim() ?? '';
      final parts = <String>[
        status == null ? error.type.name : 'HTTP $status',
      ];
      if (body.isNotEmpty) {
        parts.add(_truncate(body, 300));
      }
      return '网络请求失败: ${parts.join(' · ')}';
    }
    return '网络请求失败: ${_truncate(error.toString(), 300)}';
  }

  static String _truncate(String value, int maxLength) {
    if (value.length <= maxLength) return value;
    return '${value.substring(0, maxLength)}…';
  }

  static bool isValidMethodName(String methodName) {
    return _methodNamePattern.hasMatch(methodName);
  }

  static String wrapPluginSource(String jsCode) {
    return '(function() {\n$jsCode\n})();';
  }

  static String buildPluginCallScript(String methodName, List<dynamic>? args) {
    final argsJson = jsonEncode(args ?? const [])
        .replaceAll('\u2028', r'\u2028')
        .replaceAll('\u2029', r'\u2029');
    return '(async function() {\n'
        'try {\n'
        'if (!globalThis.plugin || typeof globalThis.plugin.$methodName !== "function") {\n'
        'return JSON.stringify({ __pluginResult: true, ok: false, error: "Method $methodName not found on plugin" });\n'
        '}\n'
        'globalThis.__pluginArgs = $argsJson;\n'
        'const res = await globalThis.plugin.$methodName.apply(globalThis.plugin, globalThis.__pluginArgs);\n'
        'return JSON.stringify({ __pluginResult: true, ok: true, value: res === undefined ? null : res });\n'
        '} catch (e) {\n'
        'const message = e && e.message ? e.message : String(e);\n'
        'return JSON.stringify({ __pluginResult: true, ok: false, error: message });\n'
        '}\n'
        '})()';
  }

  static dynamic decodePluginResult(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return null;
    try {
      return jsonDecode(text);
    } on FormatException {
      return text;
    }
  }

  static dynamic decodePluginCallResult(String raw) {
    var envelope = decodePluginResult(raw);
    if (envelope is String) {
      envelope = decodePluginResult(envelope);
    }
    if (envelope is Map && envelope['__pluginResult'] == true) {
      if (envelope['ok'] != true) {
        throw Exception(envelope['error']?.toString() ?? '插件执行失败');
      }
      return envelope['value'];
    }
    return envelope;
  }

  static String extractErrorMessage(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return '插件执行失败';
    try {
      final decoded = jsonDecode(text);
      if (decoded is Map && decoded['message'] != null) {
        return _truncate(decoded['message'].toString(), 500);
      }
      if (decoded is String) return _truncate(decoded, 500);
    } on FormatException {
      return _truncate(text, 500);
    }
    return _truncate(text, 500);
  }

  /// Evaluates plugin JS code, and registers the plugin
  Future<void> loadPlugin(String jsCode) async {
    if (_disposed) {
      throw StateError('引擎已释放，无法加载插件');
    }
    final evalRes = await _runtime.evaluateAsync(wrapPluginSource(jsCode));
    if (evalRes.isError) {
      throw Exception('插件加载失败: ${extractErrorMessage(evalRes.stringResult)}');
    }
    try {
      final settled = await _runtime.handlePromise(evalRes).timeout(callTimeout);
      if (settled.isError) {
        throw Exception('插件加载失败: ${extractErrorMessage(settled.stringResult)}');
      }
    } on TimeoutException {
      throw Exception('插件加载超时（${callTimeout.inMilliseconds} 毫秒）');
    } on Exception {
      rethrow;
    } catch (error) {
      throw Exception('插件加载失败: ${extractErrorMessage(_stringifyThrown(error))}');
    }
    final hasPlugin = await _runtime.evaluateAsync(
      'typeof globalThis.plugin === "object" && globalThis.plugin !== null',
    );
    if (hasPlugin.stringResult.trim() != 'true') {
      throw Exception('插件未注册 globalThis.plugin。');
    }
  }

  /// Calls a method on the loaded plugin and returns the result parsed into Dart objects
  Future<dynamic> callPluginMethod(String methodName, [List<dynamic>? args]) async {
    if (_disposed) {
      throw StateError('引擎已释放，无法调用插件方法');
    }
    if (!isValidMethodName(methodName)) {
      throw Exception('非法插件方法名: $methodName');
    }
    final evalRes = await _runtime.evaluateAsync(buildPluginCallScript(methodName, args));
    if (evalRes.isError) {
      throw Exception(extractErrorMessage(evalRes.stringResult));
    }
    JsEvalResult promiseRes;
    try {
      promiseRes = await _runtime.handlePromise(evalRes).timeout(callTimeout);
    } on TimeoutException {
      throw Exception('插件方法 $methodName 调用超时（${callTimeout.inMilliseconds} 毫秒）');
    } catch (error) {
      throw Exception(extractErrorMessage(_stringifyThrown(error)));
    }
    if (promiseRes.isError) {
      throw Exception(extractErrorMessage(promiseRes.stringResult));
    }
    return decodePluginCallResult(promiseRes.stringResult);
  }

  static String _stringifyThrown(Object error) {
    if (error is JsEvalResult) return error.stringResult;
    return error.toString();
  }
}
