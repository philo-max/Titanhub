import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/venera/venera_host.dart';

import 'venera_test_support.dart';

const _searchBody = {
  'pages': 1,
  'items': [
    {'id': 'c1', 'name': '搜索结果一', 'cover': '', 'desc': ''},
  ],
};

String withInit(String initBody) => fixtureSourceCode().replaceFirst(
      'url = "https://fixture.test/"',
      'url = "https://fixture.test/"\n  init() { $initBody }',
    );

String statusCheckedCode() => fixtureSourceCode().replaceFirst(
      'const json = JSON.parse(res.body)\n      return {\n        comics:',
      'if (res.status !== 200) throw "Invalid status code: " + res.status\n      const json = JSON.parse(res.body)\n      return {\n        comics:',
    );

Map<String, dynamic> _comicBody() => {
      'title': '详情标题',
      'cover': '',
      'desc': '简介',
      'author': '作者',
      'tags': ['热血'],
      'eps': [
        {'id': 'e1', 'title': '第1话'},
      ],
    };

void main() {
  final available = quickJsAvailable();
  final skip = available ? null : 'QuickJS 本机库不可用（需要 quickjs_c_bridge.dll 在 PATH）';

  group('Venera loadSetting 与脚本改写 settings', skip: skip, () {
    test('脚本把 settings.domain 覆盖为字符串后，loadSetting 取该值而不抛 TypeError', () async {
      final h = SourceHarness.create(
        [route('/search', (o, b) => FakeReply.text(jsonEncode(_searchBody)))],
        code: withInit('this.settings.domain = "https://moved.test"'),
      );
      addTearDown(h.dispose);
      await h.source.call('search', ['x']);
      expect(h.adapter.requests.last.uri.host, 'moved.test');
    });

    test('其他 key 的默认值来自快照，不受被覆盖 key 影响', () async {
      final h = SourceHarness.create(
        [route('/ep/', (o, b) => FakeReply.text(jsonEncode({'pages': ['https://img.test/p.jpg']})))],
        code: withInit('this.settings.domain = "https://moved.test"').replaceFirst(
          'return { images: JSON.parse(res.body).pages }',
          'return { images: JSON.parse(res.body).pages.map(p => p + "?q=" + this.loadSetting("quality")) }',
        ),
      );
      addTearDown(h.dispose);
      final urls = await h.source.call('getImages', ['c1::e1']) as List;
      expect(urls.single, 'https://img.test/p.jpg?q=hd');
    });

    test('已存储的设置优先于脚本改写和快照', () async {
      final h = SourceHarness.create(
        [route('/search', (o, b) => FakeReply.text(jsonEncode(_searchBody)))],
        code: withInit('this.settings.domain = "https://moved.test"'),
      );
      addTearDown(h.dispose);
      await h.source.saveSetting('domain', 'https://stored.test');
      await h.source.call('search', ['x']);
      expect(h.adapter.requests.last.uri.host, 'stored.test');
    });

    test('脚本把整个 settings 条目换成对象或删除后仍回退到快照默认值', () async {
      final h = SourceHarness.create(
        [route('/search', (o, b) => FakeReply.text(jsonEncode(_searchBody)))],
        code: withInit('this.settings.domain = { title: "坏了" }'),
      );
      addTearDown(h.dispose);
      await h.source.call('search', ['x']);
      expect(h.adapter.requests.last.uri.host, 'fixture.test');
    });

    test('settings 整体被改成字符串时 loadSetting 不抛 TypeError，describe 仍给出设置定义', () async {
      final h = SourceHarness.create(
        [route('/search', (o, b) => FakeReply.text(jsonEncode(_searchBody)))],
        code: withInit('this.settings.domain = "https://moved.test"'),
      );
      addTearDown(h.dispose);
      await h.source.call('search', ['x']);
      final info = await h.source.info();
      final domain = info.settings.firstWhere((s) => s.key == 'domain');
      expect(domain.title, '域名');
      expect(domain.defaultValue, 'https://fixture.test');
    });

    test('拷贝漫画真实脚本：refreshAppApi 覆盖 base_url 后后续搜索改走新域名且不抛错', () async {
      final code = File('assets/venera/sources/copy_manga.js').readAsStringSync();
      final h = SourceHarness.create(
        [
          route('network2', (o, b) => FakeReply(
                utf8.encode(jsonEncode({
                  'code': 200,
                  'results': {
                    'api': [
                      ['api.moved.test'],
                    ],
                  },
                })),
                delay: const Duration(milliseconds: 150),
              )),
          route('/api/v3/search/comic', (o, b) => FakeReply.text(jsonEncode({
                'results': {
                  'total': 1,
                  'list': [
                    {'path_word': 'abc', 'name': '海贼', 'cover': '', 'datetime_updated': '2024-01-01'},
                  ],
                },
              }))),
        ],
        code: code,
        key: 'copy_manga',
      );
      addTearDown(h.dispose);
      final first = await h.source.call('search', ['海贼']) as List;
      expect(first.single['id'], 'abc');
      await Future<void>.delayed(const Duration(milliseconds: 600));
      final second = await h.source.call('search', ['海贼']) as List;
      expect(second.single['id'], 'abc');
      await Future<void>.delayed(const Duration(milliseconds: 100));
      final third = await h.source.call('search', ['海贼']) as List;
      expect(third.single['id'], 'abc');
      final searches = h.adapter.requests.where((r) => r.uri.path == '/api/v3/search/comic').toList();
      expect(searches.first.uri.host, 'api.copy2000.online');
      expect(searches.last.uri.host, 'api.moved.test');
    });
  });

  group('Venera 网络错误诊断', skip: skip, () {
    test('非 2xx 带状态码、路径（不含查询）、响应体前 200 字、请求头名、服务端 message', () async {
      final longBody = jsonEncode({
        'code': 210,
        'message': '請到官網更新最新APP',
        'pad': 'x' * 400,
      });
      final h = SourceHarness.create([
        route('/search', (o, b) => FakeReply.text(longBody, status: 210)),
      ], code: statusCheckedCode());
      addTearDown(h.dispose);
      Object? error;
      try {
        await h.source.call('search', ['secretword']);
      } catch (e) {
        error = e;
      }
      final text = '$error';
      expect(text, contains('HTTP 210'));
      expect(text, contains('/search'));
      expect(text, isNot(contains('secretword')));
      expect(text, contains('服务端消息：請到官網更新最新APP'));
      expect(text, contains('User-Agent'));
      final bodyPart = RegExp('响应体：([^；）]*)').firstMatch(text)!.group(1)!;
      expect(bodyPart.length, lessThanOrEqualTo(200));
    });

    test('响应体里的 Bearer、token、cookie 被脱敏', () {
      final diagnostic = VeneraHttpDiagnostic.build(
        status: 500,
        uri: Uri.parse('https://a.test/x?token=1'),
        bytes: utf8.encode('{"msg":"bad Bearer qqq","authorization":"Bearer abc.def-ghi","token":"zzz","cookie":"sid=1; a=2"}'),
        headerNames: const ['Authorization'],
      );
      final text = diagnostic.format();
      expect(text, isNot(contains('abc.def-ghi')));
      expect(text, isNot(contains('zzz')));
      expect(text, isNot(contains('sid=1')));
      expect(text, isNot(contains('qqq')));
      expect(text, contains('Bearer ***'));
      expect(text, contains('服务端消息：bad Bearer ***'));
      expect(text, isNot(contains('token=1')));
      expect(text, contains('Authorization'));
      expect(text, isNot(contains('Bearer abc')));
    });

    test('请求头只给名称不给值', () async {
      final h = SourceHarness.create([
        route('/search', (o, b) => FakeReply.text('{}', status: 500)),
      ], code: statusCheckedCode());
      addTearDown(h.dispose);
      await expectLater(h.source.call('search', ['x']), throwsVenera('已发送请求头：'));
    });

    test('210 与 404 不附加登录配置提示，归为来源接口返回', () async {
      for (final status in [210, 404, 500]) {
        final h = SourceHarness.create(
          [route('/search', (o, b) => FakeReply.text('{"message":"nope"}', status: status))],
          config: true,
          code: statusCheckedCode(),
        );
        addTearDown(h.dispose);
        Object? error;
        try {
          await h.source.call('search', ['x']);
        } catch (e) {
          error = e;
        }
        expect('$error', contains('来源接口返回：'), reason: '$status');
        expect('$error', isNot(contains('可能需要先配置')), reason: '$status');
      }
    });

    test('401 与 403 对需配置来源附加配置提示', () async {
      for (final status in [401, 403]) {
        final h = SourceHarness.create(
          [route('/search', (o, b) => FakeReply.text('{}', status: status))],
          config: true,
          code: statusCheckedCode(),
        );
        addTearDown(h.dispose);
        await expectLater(h.source.call('search', ['x']), throwsVenera('可能需要先配置'), reason: '$status');
      }
    });

    test('响应明确提示登录时附加配置提示', () async {
      final h = SourceHarness.create(
        [route('/search', (o, b) => FakeReply.text('{"message":"请先登录"}', status: 400))],
        config: true,
        code: statusCheckedCode(),
      );
      addTearDown(h.dispose);
      await expectLater(h.source.call('search', ['x']), throwsVenera('可能需要先配置'));
    });

    test('超时不附加配置提示', () async {
      final h = SourceHarness.create(
        [route('/search', (o, b) => FakeReply(utf8.encode('{}'), delay: const Duration(milliseconds: 400)))],
        config: true,
        limits: const VeneraLimits(requestTimeout: Duration(milliseconds: 100)),
      );
      addTearDown(h.dispose);
      Object? error;
      try {
        await h.source.call('search', ['x']);
      } catch (e) {
        error = e;
      }
      expect(error, isNotNull);
      expect('$error', isNot(contains('可能需要先配置')));
    });

    test('业务错误“漫画不存在”归为来源接口返回且不提示登录', () async {
      final code = fixtureSourceCode().replaceFirst(
        'const json = JSON.parse(res.body)\n      const chapters',
        'const json = JSON.parse(res.body)\n      if (json.errno) throw json.errmsg\n      const chapters',
      );
      final h = SourceHarness.create(
        [route('/comic/c9', (o, b) => FakeReply.text('{"errno":2,"errmsg":"漫画不存在或已被删除"}'))],
        code: code,
        config: true,
      );
      addTearDown(h.dispose);
      Object? error;
      try {
        await h.source.call('getDetail', ['c9']);
      } catch (e) {
        error = e;
      }
      expect('$error', contains('来源接口返回：漫画不存在或已被删除'));
      expect('$error', isNot(contains('可能需要先配置')));
    });
  });

  group('Venera 详情缓存', skip: skip, () {
    List<FakeRoute> countingRoutes(List<int> hits, {bool failFirst = false}) => [
          route('/comic/c1', (o, b) {
            hits.add(1);
            if (failFirst && hits.length == 1) return FakeReply.text('boom', status: 500);
            return FakeReply.text(jsonEncode(_comicBody()));
          }),
        ];

    test('详情与章节只请求一次', () async {
      final hits = <int>[];
      final h = SourceHarness.create(countingRoutes(hits));
      addTearDown(h.dispose);
      final results = await Future.wait([h.source.call('getDetail', ['c1']), h.source.call('getChapters', ['c1'])]);
      expect((results[0] as Map)['title'], '详情标题');
      expect((results[1] as List).single['id'], 'c1::e1');
      await h.source.call('getDetail', ['c1']);
      expect(hits, hasLength(1));
    });

    test('超过 TTL 后重新请求', () async {
      final hits = <int>[];
      var now = DateTime.utc(2024);
      final h = SourceHarness.create(countingRoutes(hits), clock: () => now);
      addTearDown(h.dispose);
      await h.source.call('getDetail', ['c1']);
      now = now.add(const Duration(minutes: 1));
      await h.source.call('getChapters', ['c1']);
      expect(hits, hasLength(1));
      now = now.add(const Duration(minutes: 2));
      await h.source.call('getChapters', ['c1']);
      expect(hits, hasLength(2));
    });

    test('失败结果不缓存', () async {
      final hits = <int>[];
      final h = SourceHarness.create(countingRoutes(hits, failFirst: true));
      addTearDown(h.dispose);
      await expectLater(h.source.call('getDetail', ['c1']), throwsA(isA<Object>()));
      final detail = await h.source.call('getDetail', ['c1']);
      expect((detail as Map)['title'], '详情标题');
      expect(hits, hasLength(2));
    });

    test('条目数超过上限时淘汰最早的', () async {
      final hits = <String>[];
      final h = SourceHarness.create(
        [
          route('/comic/', (o, b) {
            hits.add(o.uri.path);
            return FakeReply.text(jsonEncode(_comicBody()));
          }),
        ],
        infoCacheMaxEntries: 2,
      );
      addTearDown(h.dispose);
      for (final id in ['a', 'b', 'c']) {
        await h.source.call('getDetail', [id]);
      }
      expect(hits, hasLength(3));
      await h.source.call('getDetail', ['c']);
      await h.source.call('getDetail', ['b']);
      expect(hits, hasLength(3));
      await h.source.call('getDetail', ['a']);
      expect(hits, hasLength(4));
    });
  });
}
