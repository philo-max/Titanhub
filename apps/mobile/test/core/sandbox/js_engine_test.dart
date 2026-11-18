import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sandbox/js_engine.dart';

void main() {
  group('JsEngine.isValidMethodName', () {
    test('接受合法标识符', () {
      for (final name in ['search', 'getDetail', 'getChapters', '_private', r'$jq']) {
        expect(JsEngine.isValidMethodName(name), isTrue, reason: name);
      }
    });

    test('拒绝注入型方法名', () {
      for (final name in ['', 'get Detail', 'search();', 'a-b', 'search")', 'x.y', '1abc', '搜索']) {
        expect(JsEngine.isValidMethodName(name), isFalse, reason: name);
      }
    });
  });

  group('JsEngine.buildPluginCallScript', () {
    test('参数经 JSON 编码后注入，不拼接原始文本', () {
      final script = JsEngine.buildPluginCallScript('search', ['"; throw new Error(1); //']);
      expect(script, contains('globalThis.__pluginArgs'));
      expect(script, contains(jsonEncode(['"; throw new Error(1); //'])));
      expect(script, contains('typeof globalThis.plugin.search !== "function"'));
      expect(script, isNot(contains('apply(globalThis.plugin, ["; throw')));
    });

    test('返回值包在带标记的信封里，异常转为错误信封', () {
      final script = JsEngine.buildPluginCallScript('getDetail', ['abc']);
      expect(script, contains('__pluginResult: true, ok: true'));
      expect(script, contains('__pluginResult: true, ok: false'));
      expect(script, contains('e && e.message ? e.message : String(e)'));
    });

    test('转义 U+2028/U+2029 以保证脚本可解析', () {
      final script = JsEngine.buildPluginCallScript('search', ['a\u2028b\u2029c']);
      expect(script.contains('\u2028'), isFalse);
      expect(script.contains('\u2029'), isFalse);
      expect(script, contains(r'\u2028'));
      expect(script, contains(r'\u2029'));
    });

    test('无参调用时注入空数组', () {
      final script = JsEngine.buildPluginCallScript('explore', null);
      expect(script, contains('globalThis.__pluginArgs = [];'));
    });
  });

  group('JsEngine.decodePluginResult', () {
    test('解析 JSON 对象与数组', () {
      expect(JsEngine.decodePluginResult('[{"id":"1"}]'), [
        {'id': '1'}
      ]);
      expect(JsEngine.decodePluginResult('{"id":"2"}'), {'id': '2'});
    });

    test('undefined 结果映射为 null', () {
      expect(JsEngine.decodePluginResult('null'), isNull);
      expect(JsEngine.decodePluginResult('   '), isNull);
    });

    test('非 JSON 文本按原样返回而不是抛错', () {
      expect(JsEngine.decodePluginResult('第1话 起始'), '第1话 起始');
    });
  });

  group('JsEngine.decodePluginCallResult', () {
    test('成功信封解出 value', () {
      expect(
        JsEngine.decodePluginCallResult('{"__pluginResult":true,"ok":true,"value":[{"id":"1"}]}'),
        [
          {'id': '1'}
        ],
      );
      expect(JsEngine.decodePluginCallResult('{"__pluginResult":true,"ok":true,"value":null}'), isNull);
    });

    test('失败信封抛出插件自带的错误信息', () {
      expect(
        () => JsEngine.decodePluginCallResult(
          '{"__pluginResult":true,"ok":false,"error":"MangaDex 请求过于频繁，请稍后再试。"}',
        ),
        throwsA(isA<Exception>().having(
          (e) => e.toString(),
          'message',
          contains('MangaDex 请求过于频繁'),
        )),
      );
    });

    test('旧式无信封结果保持兼容', () {
      expect(JsEngine.decodePluginCallResult('[1,2]'), [1, 2]);
    });

    test('插件自身返回 {ok:false} 的业务数据不被误判为失败', () {
      expect(
        JsEngine.decodePluginCallResult('[{"ok":false,"id":"x"}]'),
        [
          {'ok': false, 'id': 'x'}
        ],
      );
    });

    test('字符串被二次编码时仍能解出信封', () {
      final raw = jsonEncode(jsonEncode({'__pluginResult': true, 'ok': true, 'value': [1, 2]}));
      expect(JsEngine.decodePluginCallResult(raw), [1, 2]);
    });
  });

  group('JsEngine.extractErrorMessage', () {
    test('优先取结构化的 message 字段', () {
      expect(
        JsEngine.extractErrorMessage('{"message":"网络请求失败","name":"Error"}'),
        '网络请求失败',
      );
    });

    test('保留纯文本错误', () {
      expect(JsEngine.extractErrorMessage('TypeError: x is not a function'), 'TypeError: x is not a function');
    });

    test('空消息有兜底文案', () {
      expect(JsEngine.extractErrorMessage(''), isNotEmpty);
    });

    test('超长异常栈被截断', () {
      final long = 'Error: x\n${'at frame\n' * 200}';
      final message = JsEngine.extractErrorMessage(long);
      expect(message.length, lessThan(600));
      expect(message, endsWith('…'));
    });
  });

  group('JsEngine.describeNetworkError', () {
    test('保留 HTTP 状态码与响应片段', () {
      final error = DioException(
        requestOptions: RequestOptions(path: 'https://example.test/a'),
        response: Response<dynamic>(
          requestOptions: RequestOptions(path: 'https://example.test/a'),
          statusCode: 503,
          data: 'service unavailable',
        ),
        type: DioExceptionType.badResponse,
      );
      final message = JsEngine.describeNetworkError(error);
      expect(message, contains('HTTP 503'));
      expect(message, contains('service unavailable'));
    });

    test('无响应时保留 Dio 错误类型', () {
      final error = DioException(
        requestOptions: RequestOptions(path: 'https://example.test/a'),
        type: DioExceptionType.connectionTimeout,
      );
      expect(JsEngine.describeNetworkError(error), contains('connectionTimeout'));
    });

    test('超长响应体被截断，避免塞爆日志', () {
      final error = DioException(
        requestOptions: RequestOptions(path: 'https://example.test/a'),
        response: Response<dynamic>(
          requestOptions: RequestOptions(path: 'https://example.test/a'),
          statusCode: 500,
          data: 'x' * 1000,
        ),
        type: DioExceptionType.badResponse,
      );
      final message = JsEngine.describeNetworkError(error);
      expect(message.length, lessThan(400));
      expect(message, endsWith('…'));
    });
  });

  group('JsEngine.wrapPluginSource', () {
    test('包裹为独立函数作用域，避免污染全局', () {
      final wrapped = JsEngine.wrapPluginSource('globalThis.plugin = {};');
      expect(wrapped.startsWith('(function() {'), isTrue);
      expect(wrapped.trimRight().endsWith('})();'), isTrue);
      expect(wrapped, contains('globalThis.plugin = {};'));
    });
  });
}
