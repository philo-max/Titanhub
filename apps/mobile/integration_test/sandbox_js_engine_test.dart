import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:titanhub/core/sandbox/js_engine.dart';

const String _samplePlugin = r'''
const plugin = {
  id: 'sandbox-probe',
  name: 'Sandbox Probe',
  types: ['manga'],
  async echo(value) {
    return { value: value, type: typeof value };
  },
  async fail() {
    throw new Error('插件内部失败');
  },
  async load(url) {
    const res = await fetch(url);
    const body = await res.text();
    return { status: res.status, ok: res.ok, body: body };
  },
  async loadSlow(url) {
    const res = await fetch(url, { timeout: 30 });
    return await res.text();
  },
  async parse(html) {
    const items = JSON.parse(htmlParser.select(html, 'li.entry'));
    const first = JSON.parse(htmlParser.selectOne(html, 'li.entry a'));
    const text = htmlParser.selectText(html, 'li.entry');
    const href = htmlParser.selectAttribute(html, 'li.entry a', 'href');
    return {
      count: items.length,
      texts: items.map((item) => item.text),
      firstText: first ? first.text : null,
      firstHref: first ? first.attrs.href : null,
      textText: text,
      attrText: href,
    };
  },
};
globalThis.plugin = plugin;
''';

const String _sampleHtml = '''
<ul>
  <li class="entry"><a href="/a/1">第一话</a></li>
  <li class="entry"><a href="/a/2">第二话</a></li>
</ul>
''';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  late JsEngine engine;
  late HttpServer server;
  late String baseUrl;

  setUpAll(() async {
    engine = JsEngine();
    await engine.loadPlugin(_samplePlugin);

    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    baseUrl = 'http://127.0.0.1:${server.port}';
    server.listen((request) async {
      final response = request.response;
      try {
        if (request.uri.path == '/ok') {
          response.statusCode = 200;
          response.headers.contentType = ContentType.json;
          response.write(jsonEncode({'hello': '世界'}));
        } else if (request.uri.path == '/missing') {
          response.statusCode = 404;
          response.write('not found');
        } else if (request.uri.path == '/slow') {
          await Future<void>.delayed(const Duration(seconds: 5));
          response.statusCode = 200;
          response.write('late');
        } else {
          response.statusCode = 500;
          response.write('boom');
        }
        await response.close();
      } catch (_) {}
    });
  });

  tearDownAll(() async {
    engine.dispose();
    await server.close(force: true);
  });

  test('插件方法接收并回传结构化参数', () async {
    final result = await engine.callPluginMethod('echo', [
      {'id': 1, 'tags': ['a', 'b']}
    ]);
    expect(result, isA<Map>());
    expect(result['type'], 'object');
    expect(result['value'], {'id': 1, 'tags': ['a', 'b']});
  });

  test('插件抛错时把 message 透传给 Dart 调用方', () async {
    await expectLater(
      engine.callPluginMethod('fail'),
      throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('插件内部失败'))),
    );
  });

  test('不存在的方法给出明确错误', () async {
    await expectLater(
      engine.callPluginMethod('notExists'),
      throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('not found on plugin'))),
    );
  });

  test('非法方法名在进入 JS 前被拒绝', () async {
    await expectLater(
      engine.callPluginMethod('search(); process.exit(1)'),
      throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('非法插件方法名'))),
    );
  });

  test('fetch 桥接返回状态码与响应体', () async {
    final result = await engine.callPluginMethod('load', ['$baseUrl/ok']);
    expect(result['status'], 200);
    expect(result['ok'], true);
    expect(jsonDecode(result['body'] as String), {'hello': '世界'});
  });

  test('非 2xx 响应不会被当成异常，交由插件判断', () async {
    final result = await engine.callPluginMethod('load', ['$baseUrl/missing']);
    expect(result['status'], 404);
    expect(result['ok'], false);
    expect(result['body'], 'not found');
  });

  test('htmlParser 桥接返回 text/attrs 结构', () async {
    final result = await engine.callPluginMethod('parse', [_sampleHtml]);
    expect(result['count'], 2);
    expect(result['texts'], ['第一话', '第二话']);
    expect(result['firstHref'], '/a/1');
    expect(result['textText'], '第一话');
    expect(result['attrText'], '/a/1');
  });

  test('插件加载失败时抛出可读异常', () async {
    final broken = JsEngine();
    try {
      await expectLater(broken.loadPlugin('const plugin = {;'), throwsA(isA<Exception>()));
    } finally {
      broken.dispose();
    }
  });

  test('未注册 plugin 的脚本被拒绝', () async {
    final empty = JsEngine();
    try {
      await expectLater(
        empty.loadPlugin('const nothing = 1;'),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('globalThis.plugin'))),
      );
    } finally {
      empty.dispose();
    }
  });

  test('真实 mangadex 资源可加载且非漫画类型不触发网络', () async {
    final source = await rootBundle.loadString('assets/plugins/mangadex.js');
    final real = JsEngine();
    try {
      await real.loadPlugin(source);
      final results = await real.callPluginMethod('explore', ['movie']);
      expect(results, isEmpty);
    } finally {
      real.dispose();
    }
  });

  test('dispose 期间的在途慢请求被取消，调用方收到异常而非挂起', () async {
    final local = JsEngine();
    await local.loadPlugin(_samplePlugin);
    final pending = local.callPluginMethod('loadSlow', ['$baseUrl/slow']);
    await Future<void>.delayed(const Duration(milliseconds: 300));

    final stopwatch = Stopwatch()..start();
    local.dispose();
    await expectLater(pending, throwsA(isA<Exception>()));
    stopwatch.stop();

    expect(stopwatch.elapsed, lessThan(const Duration(seconds: 3)));
  });

  test('dispose 后调用被拒绝，且不再向已释放的运行时求值', () async {
    final local = JsEngine();
    await local.loadPlugin(_samplePlugin);
    final inFlight = local.callPluginMethod('loadSlow', ['$baseUrl/slow']).catchError((Object _) => null);
    await Future<void>.delayed(const Duration(milliseconds: 200));

    local.dispose();

    await expectLater(local.callPluginMethod('echo', [1]), throwsA(isA<StateError>()));
    await expectLater(local.loadPlugin(_samplePlugin), throwsA(isA<StateError>()));
    await inFlight;
    await Future<void>.delayed(const Duration(milliseconds: 600));
  });

  test('整次调用受 callTimeout 约束，慢请求不会无限等待', () async {
    final local = JsEngine(callTimeout: const Duration(milliseconds: 800));
    await local.loadPlugin(_samplePlugin);
    try {
      final stopwatch = Stopwatch()..start();
      await expectLater(
        local.callPluginMethod('loadSlow', ['$baseUrl/slow']),
        throwsA(isA<Exception>().having((e) => e.toString(), 'message', contains('调用超时'))),
      );
      stopwatch.stop();
      expect(stopwatch.elapsed, lessThan(const Duration(seconds: 5)));
    } finally {
      local.dispose();
    }
  });

  test('并发调用互不干扰，结果各自返回', () async {
    final results = await Future.wait([
      engine.callPluginMethod('echo', ['first']),
      engine.callPluginMethod('echo', ['second']),
      engine.callPluginMethod('load', ['$baseUrl/ok']),
    ]);
    expect(results[0]['value'], 'first');
    expect(results[1]['value'], 'second');
    expect(results[2]['status'], 200);
  });
}
