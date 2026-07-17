import 'dart:convert';
import 'package:flutter_js/flutter_js.dart';
import 'package:dio/dio.dart';
import 'package:html/parser.dart' as parser;

class JsEngine {
  late final JavascriptRuntime _runtime;
  final _dio = Dio(BaseOptions(
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 15),
  ));

  JsEngine() {
    _runtime = getJavascriptRuntime();
    _setupBridge();
  }

  void dispose() {
    _runtime.dispose();
  }

  void _setupBridge() {
    // 1. Console log
    _runtime.onMessage('log', (dynamic args) {
      print('[JS Log] $args');
    });
    _runtime.onMessage('error', (dynamic args) {
      print('[JS Error] $args');
    });

    // 2. Fetch
    _runtime.onMessage('fetch', (dynamic args) async {
      try {
        final params = jsonDecode(args as String);
        final url = params['url'] as String;
        final reqId = params['reqId'] as String;
        final options = params['options'] ?? {};
        
        final method = (options['method'] as String?)?.toUpperCase() ?? 'GET';
        final headers = Map<String, dynamic>.from(options['headers'] ?? {});
        final body = options['body'];

        final response = await _dio.request(
          url,
          options: Options(
            method: method,
            headers: headers,
            responseType: ResponseType.plain,
          ),
          data: body,
        );

        final status = response.statusCode ?? 200;
        final bodyStr = response.data?.toString() ?? '';

        final escapedBody = jsonEncode(bodyStr);
        _runtime.evaluate("globalThis._resolveRequest('$reqId', $status, $escapedBody)");
      } catch (e) {
        final reqId = jsonDecode(args as String)['reqId'] as String;
        _runtime.evaluate("globalThis._rejectRequest('$reqId', ${jsonEncode(e.toString())})");
      }
    });

    // 3. HTML selectors (Cheerio replacements)
    _runtime.onMessage('select', (dynamic args) {
      final params = jsonDecode(args as String);
      final html = params['html'] as String;
      final selector = params['selector'] as String;
      
      final document = parser.parse(html);
      final elements = document.querySelectorAll(selector);
      final list = elements.map((el) {
        final attrs = <String, String>{};
        el.attributes.forEach((key, val) {
          attrs[key.toString()] = val;
        });
        return {
          'text': el.text.trim(),
          'html': el.outerHtml,
          'attrs': attrs,
        };
      }).toList();
      return jsonEncode(list);
    });

    _runtime.onMessage('selectOne', (dynamic args) {
      final params = jsonDecode(args as String);
      final html = params['html'] as String;
      final selector = params['selector'] as String;
      
      final document = parser.parse(html);
      final el = document.querySelector(selector);
      if (el == null) return 'null';
      
      final attrs = <String, String>{};
      el.attributes.forEach((key, val) {
        attrs[key.toString()] = val;
      });
      return jsonEncode({
        'text': el.text.trim(),
        'html': el.outerHtml,
        'attrs': attrs,
      });
    });

    _runtime.onMessage('selectText', (dynamic args) {
      final params = jsonDecode(args as String);
      final html = params['html'] as String;
      final selector = params['selector'] as String;
      
      final document = parser.parse(html);
      final el = document.querySelector(selector);
      return el?.text.trim() ?? '';
    });

    _runtime.onMessage('selectAttribute', (dynamic args) {
      final params = jsonDecode(args as String);
      final html = params['html'] as String;
      final selector = params['selector'] as String;
      final attr = params['attr'] as String;
      
      final document = parser.parse(html);
      final el = document.querySelector(selector);
      return el?.attributes[attr] ?? '';
    });

    // 4. Inject runtime helper environment JS
    _runtime.evaluate("""
      globalThis.console = {
        log: function(...args) { sendMessage('log', args.join(' ')); },
        error: function(...args) { sendMessage('error', args.join(' ')); }
      };

      globalThis._pendingRequests = {};
      globalThis._resolveRequest = function(reqId, status, body) {
        const req = globalThis._pendingRequests[reqId];
        if (req) {
          delete globalThis._pendingRequests[reqId];
          req.resolve({
            status: status,
            text: async () => body,
            json: async () => JSON.parse(body)
          });
        }
      };
      globalThis._rejectRequest = function(reqId, error) {
        const req = globalThis._pendingRequests[reqId];
        if (req) {
          delete globalThis._pendingRequests[reqId];
          req.reject(new Error(error));
        }
      };

      globalThis.fetch = function(url, options) {
        return new Promise((resolve, reject) => {
          const reqId = Math.random().toString(36).substring(7);
          globalThis._pendingRequests[reqId] = { resolve, reject };
          sendMessage('fetch', JSON.stringify({ url, options, reqId }));
        });
      };

      globalThis.select = function(html, selector) {
        const res = sendMessage('select', JSON.stringify({ html, selector }));
        return JSON.parse(res);
      };

      globalThis.selectOne = function(html, selector) {
        const res = sendMessage('selectOne', JSON.stringify({ html, selector }));
        return JSON.parse(res);
      };

      globalThis.selectText = function(html, selector) {
        return sendMessage('selectText', JSON.stringify({ html, selector }));
      };

      globalThis.selectAttribute = function(html, selector, attr) {
        return sendMessage('selectAttribute', JSON.stringify({ html, selector, attr }));
      };
    """);
  }

  /// Evaluates plugin JS code, and registers the plugin
  Future<void> loadPlugin(String jsCode) async {
    final evalRes = await _runtime.evaluateAsync(jsCode);
    await _runtime.handlePromise(evalRes);
  }

  /// Calls a method on the loaded plugin and returns the result parsed into Dart objects
  Future<dynamic> callPluginMethod(String methodName, [List<dynamic>? args]) async {
    final argsJson = jsonEncode(args ?? []);
    final evalRes = await _runtime.evaluateAsync('''
      (async function() {
        if (!globalThis.plugin || !globalThis.plugin.$methodName) {
          throw new Error("Method $methodName not found on plugin");
        }
        const res = await globalThis.plugin.$methodName.apply(globalThis.plugin, $argsJson);
        return JSON.stringify(res);
      })()
    ''');
    final promiseRes = await _runtime.handlePromise(evalRes);
    final stringRes = promiseRes.stringResult;
    return jsonDecode(stringRes);
  }
}
