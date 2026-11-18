import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/venera/venera_host.dart';

import 'venera_test_support.dart';

final routes = <FakeRoute>[
  route('/home', (o, b) => FakeReply.text('<ul class="list"><li><a href="c1">第一部</a><img src="https://img.test/1.jpg"></li><li><a href="c2">第二部</a><img src="https://img.test/2.jpg"></li></ul>')),
  route('/search', (o, b) => FakeReply.text(jsonEncode({
        'pages': 3,
        'items': [
          {'id': 'c1', 'name': '搜索结果一', 'cover': 'https://img.test/1.jpg', 'desc': '简介一'},
          {'id': 'c2', 'name': '搜索结果二', 'cover': 'https://img.test/2.jpg', 'desc': ''},
        ],
      }))),
  route('/comic/c1', (o, b) => FakeReply.text(jsonEncode({
        'title': '详情标题',
        'cover': 'https://img.test/1.jpg',
        'desc': '详情简介',
        'author': '作者甲',
        'tags': ['热血', '冒险'],
        'eps': [
          {'id': 'e1', 'title': '第1话'},
          {'id': 'e2', 'title': '第2话'},
        ],
      }))),
  route('/ep/c1/e2', (o, b) => FakeReply.text(jsonEncode({
        'pages': ['https://img.test/p1.jpg', 'https://img.test/p2.jpg'],
      }))),
];

void main() {
  final available = quickJsAvailable();
  final skip = available ? null : 'QuickJS 本机库不可用（需要 quickjs_c_bridge.dll 在 PATH）';

  group('Venera 契约映射', skip: skip, () {
    late SourceHarness h;
    setUp(() => h = SourceHarness.create(routes));
    tearDown(() => h.dispose());

    test('search 返回与现有来源一致的形状，id 为字符串', () async {
      final List result = await h.source.call('search', ['关键词']);
      expect(result, hasLength(2));
      expect(result.first, {'id': 'c1', 'title': '搜索结果一', 'cover': 'https://img.test/1.jpg', 'description': '简介一'});
      expect(h.adapter.requests.first.uri.toString(), contains('q=%E5%85%B3%E9%94%AE%E8%AF%8D'));
    });

    test('空关键词不发请求', () async {
      expect(await h.source.call('search', ['  ']), isEmpty);
      expect(h.adapter.requests, isEmpty);
    });

    test('explore 支持 multiPartPage 并走 HtmlDocument', () async {
      final List result = await h.source.call('explore', ['manga']);
      expect(result.map((e) => e['id']), ['c1', 'c2']);
      expect(result.first['title'], '第一部');
      expect(result.first['cover'], 'https://img.test/1.jpg');
      expect(result.first['description'], '副标题');
    });

    test('getDetail 映射标题、简介、标签与更新时间', () async {
      final Map detail = await h.source.call('getDetail', ['c1']);
      expect(detail['id'], 'c1');
      expect(detail['title'], '详情标题');
      expect(detail['genres'], ['作者甲', '热血', '冒险']);
      expect(detail['status'], '2024-01-02');
    });

    test('getChapters 使用 comicId::epId 章节 id（与桌面 adaptVenera 一致），Map 保持顺序', () async {
      final List chapters = await h.source.call('getChapters', ['c1']);
      expect(chapters.map((c) => c['id']), ['c1::e1', 'c1::e2']);
      expect(chapters.map((c) => c['title']), ['第1话', '第2话']);
      expect(chapters.map((c) => c['chapterNo']), [1, 2]);
    });

    test('getImages 拆分 comicId::epId，经 onImageLoad 合并请求头并登记到图片头表', () async {
      final List<String> images = List<String>.from(await h.source.call('getImages', ['c1::e2']));
      expect(images, ['https://img.test/p1.jpg', 'https://img.test/p2.jpg']);
      final headers = h.source.imageHeaders(images.first)!;
      expect(headers['Referer'], 'https://fixture.test/');
      expect(headers['X-Ep'], 'e2');
      expect(headers['User-Agent'], isNotEmpty);
      expect(h.adapter.requests.single.uri.path, '/ep/c1/e2');
    });

    test('未知方法明确报错', () async {
      expect(h.source.call('getContent', ['x']), throwsVenera('不支持方法'));
    });

    test('无章节来源映射为单话，loadEp 的 ep 为 null', () async {
      final code = fixtureSourceCode()
          .replaceAll('chapters: chapters,', '')
          .replaceAll('return { images: JSON.parse(res.body).pages }', 'return { images: [String(epId === null ? "null-ep" : epId)] }');
      final solo = SourceHarness.create(routes, code: code);
      addTearDown(solo.dispose);
      final List chapters = await solo.source.call('getChapters', ['c1']);
      expect(chapters, [
        {'id': 'c1::', 'title': '全一话', 'chapterNo': 1}
      ]);
      expect(await solo.source.call('getImages', ['c1::']), ['null-ep']);
    });

    test('分组章节展开并带 groupId/groupName', () async {
      final code = fixtureSourceCode().replaceAll(
        'chapters: chapters,',
        'chapters: { "上卷": { a1: "上1", a2: "上2" }, "下卷": { b1: "下1" } },',
      );
      final grouped = SourceHarness.create(routes, code: code);
      addTearDown(grouped.dispose);
      final List chapters = await grouped.source.call('getChapters', ['c1']);
      expect(chapters.map((c) => c['id']), ['c1::a1', 'c1::a2', 'c1::b1']);
      expect(chapters.map((c) => c['groupName']), ['上卷', '上卷', '下卷']);
      expect(chapters.map((c) => c['chapterNo']), [1, 2, 3]);
    });

    test('mixed / multiPageComicList / singlePageWithMultiPart 首页类型', () async {
      String variant(String body) => fixtureSourceCode().replaceAll(
            RegExp(r'explore = \[\{[\s\S]*?\n  \}\]\n'),
            'explore = [$body]\n',
          );
      Future<List> run(String body) async {
        final s = SourceHarness.create(routes, code: variant(body));
        addTearDown(s.dispose);
        return await s.source.call('explore', []) as List;
      }

      expect(
        (await run('{ title: "m", type: "mixed", load: async (i) => ({ data: [[{id:"a",title:"A"}], {title:"p", comics:[{id:"b",title:"B"}]}], maxPage: 1 }) }')).map((e) => e['id']),
        ['a', 'b'],
      );
      expect(
        (await run('{ title: "l", type: "multiPageComicList", load: async (p) => ({ comics: [{id:"c",title:"C"}], maxPage: 2 }) }')).map((e) => e['id']),
        ['c'],
      );
      expect(
        (await run('{ title: "s", type: "singlePageWithMultiPart", load: async () => ({ "热门": [{id:"d",title:"D"}] }) }')).map((e) => e['id']),
        ['d'],
      );
      final bad = SourceHarness.create(routes, code: variant('{ title: "x", type: "weird", load: async () => [] }'));
      addTearDown(bad.dispose);
      expect(bad.source.call('explore', []), throwsVenera('需要宿主能力：首页类型 weird'));
    });
  });

  group('Venera 来源设置与登录', skip: skip, () {
    test('设置覆盖域名并持久化到来源自己的数据文件', () async {
      final h = SourceHarness.create(routes);
      addTearDown(h.dispose);
      var info = await h.source.info();
      expect(info.settings.firstWhere((s) => s.key == 'domain').value, 'https://fixture.test');
      expect(info.canPasswordLogin, isTrue);
      expect(info.isLogged, isFalse);
      await h.source.saveSetting('domain', 'https://mirror.test');
      await h.source.call('search', ['x']);
      expect(h.adapter.requests.last.uri.host, 'mirror.test');
      info = await h.source.info();
      expect(info.settings.firstWhere((s) => s.key == 'domain').value, 'https://mirror.test');
      final saved = jsonDecode(await h.store.dataFile('venera-fixture_src').readAsString());
      expect(saved['settings']['domain'], 'https://mirror.test');
    });

    test('密码登录成功后记录账号与 Cookie，登出清除', () async {
      final h = SourceHarness.create([
        route('/login', (o, b) => FakeReply.text('ok', headers: {'set-cookie': ['sid=abc123; Path=/; HttpOnly']})),
        ...routes,
      ]);
      addTearDown(h.dispose);
      await h.source.login('alice', 'pw');
      expect(h.adapter.bodies.first, 'u=alice&p=pw');
      await h.source.call('search', ['x']);
      expect(h.adapter.requests.last.headers['Cookie'], contains('sid=abc123'));
      expect((await h.source.info()).isLogged, isTrue);
      expect(h.store.cookieFile('venera-fixture_src').existsSync(), isTrue);
      await h.source.logout();
      expect((await h.source.info()).isLogged, isFalse);
      await h.source.call('search', ['x']);
      expect(h.adapter.requests.last.headers['Cookie'], isNull);
    });

    test('登录失败抛出来源错误且不记录账号', () async {
      final h = SourceHarness.create([route('/login', (o, b) => FakeReply.text('no', status: 401))], config: true);
      addTearDown(h.dispose);
      await expectLater(h.source.login('a', 'b'), throwsVenera('Login failed: 401'));
      expect((await h.source.info()).isLogged, isFalse);
    });

    test('Cookie 按来源隔离，不跨来源共享', () async {
      final shared = Directory.systemTemp.createTempSync('venera-iso');
      final cookieRoutes = [
        route('/login', (o, b) => FakeReply.text('ok', headers: {'set-cookie': ['sid=SECRET; Path=/']})),
        ...routes,
      ];
      final a = SourceHarness.create(cookieRoutes, key: 'src_a', sharedDir: shared);
      final b = SourceHarness.create(routes, key: 'src_b', sharedDir: shared);
      addTearDown(a.dispose);
      addTearDown(b.dispose);
      await a.source.login('u', 'p');
      await b.source.call('search', ['x']);
      expect(b.adapter.requests.last.headers['Cookie'], isNull);
      expect(File('${shared.path}/data/venera-src_b.cookies.json').existsSync(), isFalse);
    });

    test('Cookie 与账号不写入日志容器', () async {
      final h = SourceHarness.create([
        route('/login', (o, b) => FakeReply.text('ok', headers: {'set-cookie': ['sid=SECRET; Path=/']})),
      ]);
      addTearDown(h.dispose);
      await h.source.login('alice', 'hunter2');
      final dump = (await h.source.recentLogs()).join(';');
      expect(dump, isNot(contains('hunter2')));
      expect(dump, isNot(contains('SECRET')));
    });
  });

  group('Venera 限制与安全', skip: skip, () {
    test('请求数上限：死循环请求被截断', () async {
      final code = fixtureSourceCode().replaceAll(
        'const res = await Network.get(`\${this.loadSetting("domain")}/search?q=\${encodeURIComponent(keyword)}&page=\${page}`, {})',
        'let res; for (let i = 0; i < 1000; i++) { res = await Network.get("https://fixture.test/search?i=" + i, {}) }',
      );
      final h = SourceHarness.create(routes, code: code, limits: const VeneraLimits(maxRequests: 5));
      addTearDown(h.dispose);
      await expectLater(h.source.call('search', ['x']), throwsVenera('请求数上限'));
      expect(h.adapter.requests.length, lessThanOrEqualTo(5));
    });

    test('总时限：永不返回的脚本被终止并可重建运行时', () async {
      final code = fixtureSourceCode().replaceAll(
        'const res = await Network.get(`\${this.loadSetting("domain")}/search?q=\${encodeURIComponent(keyword)}&page=\${page}`, {})',
        'await new Promise(() => {}); const res = null',
      );
      final h = SourceHarness.create(routes, code: code, limits: const VeneraLimits(callTimeout: Duration(milliseconds: 600)));
      addTearDown(h.dispose);
      await expectLater(h.source.call('search', ['x']), throwsVenera('执行超时'));
      expect(await h.source.call('explore', []), isNotEmpty);
    });

    test('取消：进行中的调用立即以已取消结束', () async {
      final h = SourceHarness.create([
        route('/search', (o, b) => FakeReply(utf8.encode('{}'), delay: const Duration(seconds: 5))),
      ]);
      addTearDown(h.dispose);
      final pending = h.source.call('search', ['x']);
      await Future<void>.delayed(const Duration(milliseconds: 200));
      await h.source.cancel();
      await expectLater(pending, throwsVenera('已取消'));
    });

    test('单个响应超过体积上限被拒绝', () async {
      final h = SourceHarness.create(
        [route('/search', (o, b) => FakeReply(List.filled(4096, 65)))],
        limits: const VeneraLimits(maxResponseBytes: 1024),
      );
      addTearDown(h.dispose);
      await expectLater(h.source.call('search', ['x']), throwsVenera('大小上限'));
    });

    test('回环与非 http 地址被拒绝，脚本拿不到文件系统', () async {
      expect(VeneraHost.isBlockedHost('localhost'), isTrue);
      expect(VeneraHost.isBlockedHost('127.0.0.1'), isTrue);
      expect(VeneraHost.isBlockedHost('169.254.169.254'), isTrue);
      expect(VeneraHost.isBlockedHost('example.com'), isFalse);
      final code = fixtureSourceCode().replaceAll('this.loadSetting("domain")', '"file://"');
      final h = SourceHarness.create(routes, code: code);
      addTearDown(h.dispose);
      await expectLater(h.source.call('search', ['x']), throwsVenera('只允许 http/https'));
      final probe = SourceHarness.create(routes, code: fixtureSourceCode().replaceAll(
        'const json = JSON.parse(res.body)\n      return {\n        comics:',
        'const json = {items: [{id: String(typeof require) + typeof process + typeof std + typeof os, name: "t"}]}\n      return {\n        comics:',
      ));
      addTearDown(probe.dispose);
      final List found = await probe.source.call('search', ['x']);
      expect(found.first['id'], 'undefinedundefinedundefinedundefined');
    });

    test('未支持的宿主能力明确抛错而不是静默空结果', () async {
      Future<void> expectUnsupported(String statement, String capability) async {
        final code = fixtureSourceCode().replaceAll(
          'const json = JSON.parse(res.body)\n      return {\n        comics:',
          '$statement\n      const json = JSON.parse(res.body)\n      return {\n        comics:',
        );
        final h = SourceHarness.create(routes, code: code);
        addTearDown(h.dispose);
        await expectLater(h.source.call('search', ['x']), throwsVenera('需要宿主能力：$capability'));
      }

      await expectUnsupported('UI.showDialog("t", "c", [])', 'UI.showDialog');
      await expectUnsupported('UI.launchUrl("https://x.test")', 'UI.launchUrl');
      await expectUnsupported('Convert.decryptRsa(new ArrayBuffer(1), "k")', 'Convert.decryptRsa');
      await expectUnsupported('Convert.decodeGbk(new ArrayBuffer(1))', 'Convert.decodeGbk');
      await expectUnsupported('Convert.decryptAesCfb(new ArrayBuffer(16), new ArrayBuffer(16), new ArrayBuffer(16), 16)', 'Convert.decryptAesCfb');
      await expectUnsupported('compute(() => 1)', 'compute');
    });

    test('图片 modifyImage / onResponse / 带请求体的图片请求明确报错', () async {
      for (final entry in {
        'modifyImage: "x"': 'modifyImage',
        'onResponse: (r) => r': 'onResponse',
        'data: "body"': '带请求体',
        'method: "POST"': '非 GET',
      }.entries) {
        final code = fixtureSourceCode().replaceAll('headers: { Referer', '${entry.key}, headers: { Referer');
        final h = SourceHarness.create(routes, code: code);
        addTearDown(h.dispose);
        await expectLater(h.source.call('getImages', ['c1::e2']), throwsVenera(entry.value));
      }
    });

    test('需配置来源出错时附带配置提示，宿主能力错误保持原样', () async {
      final h = SourceHarness.create([route('/search', (o, b) => FakeReply.text('login required', status: 200))], config: true);
      addTearDown(h.dispose);
      await expectLater(h.source.call('search', ['x']), throwsVenera('可能需要先配置'));
    });

    test('语法错误的来源加载失败而不拖垮应用', () async {
      final h = SourceHarness.create(routes, code: 'class Broken extends ComicSource { name = ; }');
      addTearDown(h.dispose);
      await expectLater(h.source.call('search', ['x']), throwsA(isA<Object>()));
    });
  });
}
