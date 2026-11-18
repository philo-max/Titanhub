import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/seven_se_fun_source.dart';

class _FixtureAdapter implements HttpClientAdapter {
  _FixtureAdapter(this.routes);

  final Map<String, _Fixture> routes;
  final List<RequestOptions> calls = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    final path = options.uri.path;
    final fixture = routes[path];
    if (fixture == null) {
      return ResponseBody.fromString('not found', 404);
    }
    return ResponseBody.fromString(
      fixture.body,
      fixture.status,
      headers: {
        Headers.contentTypeHeader: ['text/html; charset=utf-8'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

class _Fixture {
  const _Fixture(this.body, {this.status = 200});

  final String body;
  final int status;
}

String _readFixture(String name) {
  final file = File('test/core/sources/fixtures/$name');
  return file.readAsStringSync();
}

Dio _dio(_FixtureAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: SevenSeFunSource.origin));
  dio.httpClientAdapter = adapter;
  return dio;
}

void main() {
  final searchHtml = _readFixture('seven_se_fun_search.html');
  final detailHtml = _readFixture('seven_se_fun_detail.html');

  group('search', () {
    test('解析真实搜索结果结构，id 与桌面 encodeURIComponent 一致', () async {
      final adapter = _FixtureAdapter({
        '/vodsearch/-------------.html': _Fixture(searchHtml),
      });
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      final results = await source.search('柯南');

      expect(results, hasLength(2));
      expect(results.first['id'], Uri.encodeComponent('/voddetail/27146.html'));
      expect(results.first['title'], '名侦探柯南');
      expect(results.first['cover'], contains('p.qpic.cn'));
      expect(results[1]['title'], '名侦探柯南：万圣节的新娘');
      expect(results[1]['id'], Uri.encodeComponent('/voddetail/33289.html'));
    });

    test('请求带 UA 与 Referer，关键词按 searchURL 模板编码', () async {
      final adapter = _FixtureAdapter({
        '/vodsearch/-------------.html': _Fixture(searchHtml),
      });
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      await source.search('名侦探柯南');

      final request = adapter.calls.single;
      expect(request.uri.queryParameters['wd'], '名侦探柯南');
      expect(request.headers['User-Agent'], SevenSeFunSource.userAgent);
      expect(request.headers['Referer'], '${SevenSeFunSource.origin}/');
    });

    test('空关键词不发请求', () async {
      final adapter = _FixtureAdapter({});
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      expect(await source.search('   '), isEmpty);
      expect(adapter.calls, isEmpty);
    });

    test('无结果页面返回空列表而不是报错', () async {
      final adapter = _FixtureAdapter({
        '/vodsearch/-------------.html': const _Fixture(
          '<html><body><div class="main-container">'
          '<div class="videos"></div></div></body></html>',
        ),
      });
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      expect(await source.search('zzzz'), isEmpty);
    });
  });

  group('getDetail', () {
    test('从详情页解析标题、封面、简介、类型与导演', () async {
      final adapter = _FixtureAdapter({
        '/voddetail/27146.html': _Fixture(detailHtml),
      });
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      final detail = await source.getDetail(
        Uri.encodeComponent('/voddetail/27146.html'),
      );

      expect(detail['id'], Uri.encodeComponent('/voddetail/27146.html'));
      expect(detail['title'], '名侦探柯南');
      expect(detail['cover'], contains('p.qpic.cn'));
      expect(detail['description'], contains('江户川柯南'));
      expect(detail['genres'], ['日漫']);
      expect(detail['author'], '儿玉兼嗣,山本泰一郎');
      expect(detail['status'], '更新至1277话');
    });

    test('详情页缺封面时回落到 og:image，不返回占位图', () async {
      final html = detailHtml.replaceFirst(
        '<img class="author-img" src="http://p.qpic.cn/music_cover/PiajxSqBRaEKia1eoHwIziaXrAdmbNMt62F7v9YRzerlpLk8jFBrqC5PA/600" />',
        '<img class="author-img" />',
      );
      final adapter = _FixtureAdapter({'/voddetail/27146.html': _Fixture(html)});
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      final detail = await source.getDetail(
        Uri.encodeComponent('/voddetail/27146.html'),
      );

      expect(detail['cover'], '${SevenSeFunSource.origin}/upload/vod/20250409-1/conan-og.jpg');
    });
  });

  group('getChapters', () {
    test('不同线路的相同章节地址仍保留各自线路上下文', () async {
      final duplicateHtml = detailHtml.replaceAll('/vodplay/27146-2-1.html', '/vodplay/27146-1-1.html');
      final source = SevenSeFunSource(dio: _dio(_FixtureAdapter({
        '/voddetail/27146.html': _Fixture(duplicateHtml),
      })));
      addTearDown(source.dispose);
      final chapters = await source.getChapters(Uri.encodeComponent('/voddetail/27146.html'));
      final matches = chapters.where((c) => c['id'] == Uri.encodeComponent('/vodplay/27146-1-1.html'));
      expect(matches.map((c) => c['groupId']).toSet(), {'line-1', 'line-2'});
    });

    test('保留桌面章节 id 编码，多线路带 groupId/groupName', () async {
      final adapter = _FixtureAdapter({
        '/voddetail/27146.html': _Fixture(detailHtml),
      });
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      final chapters = await source.getChapters(
        Uri.encodeComponent('/voddetail/27146.html'),
      );

      expect(chapters, hasLength(6));
      expect(chapters.first['id'], Uri.encodeComponent('/vodplay/27146-1-1.html'));
      expect(chapters.first['title'], '第1001集');
      expect(chapters.first['chapterNo'], 1001);
      expect(chapters.first['groupId'], 'line-1');
      expect(chapters.first['groupName'], '七色A线');
      expect(chapters.first['lineId'], 'line-1');
      expect(chapters.first['lineName'], '七色A线');

      final secondLine = chapters[3];
      expect(secondLine['id'], Uri.encodeComponent('/vodplay/27146-2-1.html'));
      expect(secondLine['groupId'], 'line-2');
      expect(secondLine['groupName'], '七色B线');
      expect(secondLine['chapterNo'], 1);
    });

    test('无编号章节 chapterNo 留空，不伪造自然序号', () async {
      final adapter = _FixtureAdapter({
        '/voddetail/27146.html': _Fixture(detailHtml),
      });
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      final chapters = await source.getChapters(
        Uri.encodeComponent('/voddetail/27146.html'),
      );

      final special = chapters.last;
      expect(special['title'], 'SP');
      expect(special.containsKey('chapterNo'), isTrue);
      expect(special['chapterNo'], isNull);
    });
  });

  group('getVideoUrl', () {
    test('返回真实播放网页，不替换成示例片', () async {
      final adapter = _FixtureAdapter({});
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      final videos = await source.getVideoUrl(
        Uri.encodeComponent('/vodplay/27146-1-1.html'),
      );

      expect(videos, hasLength(1));
      expect(videos.single['url'], '${SevenSeFunSource.origin}/vodplay/27146-1-1.html');
      expect(videos.single['type'], 'page');
      expect(videos.single['quality'], '默认');
      final headers = videos.single['headers'] as Map;
      expect(headers['User-Agent'], SevenSeFunSource.userAgent);
      expect(headers['Referer'], '${SevenSeFunSource.origin}/vodplay/27146-1-1.html');
    });

    test('章节 id 已是媒体直链时按 file 返回', () async {
      final source = SevenSeFunSource(dio: _dio(_FixtureAdapter({})));
      addTearDown(source.dispose);

      final videos = await source.getVideoUrl(
        Uri.encodeComponent('${SevenSeFunSource.origin}/vodplay/27146-1-1.m3u8'),
      );

      expect(videos.single['type'], 'file');
      expect(videos.single['url'], '${SevenSeFunSource.origin}/vodplay/27146-1-1.m3u8');
    });
  });

  group('错误与边界', () {
    test('403 返回明确错误而不是假空结果', () async {
      final adapter = _FixtureAdapter({
        '/vodsearch/-------------.html': const _Fixture('forbidden', status: 403),
      });
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      await expectLater(
        source.search('柯南'),
        throwsA(isA<SevenSeFunException>().having(
          (e) => e.message,
          'message',
          contains('403'),
        )),
      );
    });

    test('超时返回明确错误', () async {
      final adapter = _FixtureAdapter({});
      final dio = _dio(adapter);
      dio.httpClientAdapter = _TimeoutAdapter();
      final source = SevenSeFunSource(dio: dio);
      addTearDown(source.dispose);

      await expectLater(
        source.search('柯南'),
        throwsA(isA<SevenSeFunException>().having(
          (e) => e.message,
          'message',
          contains('超时'),
        )),
      );
    });

    test('结构无法识别时明确报错，不静默返回空', () async {
      final adapter = _FixtureAdapter({
        '/vodsearch/-------------.html': const _Fixture('<html><body>blocked</body></html>'),
      });
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      await expectLater(
        source.search('柯南'),
        throwsA(isA<SevenSeFunException>()),
      );
    });

    test('拒绝站外地址与非 HTTP(S) 协议', () async {
      final source = SevenSeFunSource(dio: _dio(_FixtureAdapter({})));
      addTearDown(source.dispose);

      await expectLater(
        source.getDetail(Uri.encodeComponent('https://evil.example.com/voddetail/1.html')),
        throwsA(isA<SevenSeFunException>()),
      );
      await expectLater(
        source.getDetail(Uri.encodeComponent('file:///etc/passwd')),
        throwsA(isA<SevenSeFunException>()),
      );
    });

    test('未知方法与缺参数报错', () async {
      final source = SevenSeFunSource(dio: _dio(_FixtureAdapter({})));
      addTearDown(source.dispose);

      await expectLater(source.call('explore', []), throwsA(isA<SevenSeFunException>()));
      await expectLater(source.call('search', []), throwsA(isA<SevenSeFunException>()));
    });

    test('dispose 后不再接受调用', () async {
      final source = SevenSeFunSource(dio: _dio(_FixtureAdapter({})));
      source.dispose();

      await expectLater(
        source.search('柯南'),
        throwsA(isA<SevenSeFunException>().having(
          (e) => e.message,
          'message',
          contains('已释放'),
        )),
      );
    });

    test('call 分发与 runner 的调用形状一致', () async {
      final adapter = _FixtureAdapter({
        '/vodsearch/-------------.html': _Fixture(searchHtml),
      });
      final source = SevenSeFunSource(dio: _dio(adapter));
      addTearDown(source.dispose);

      final results = await source.call('search', ['柯南']) as List;
      expect(results, hasLength(2));
      expect(results.first, isA<Map<String, dynamic>>());
      expect(utf8.encode(results.first['title'] as String), isNotEmpty);
    });
  });
}

class _TimeoutAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) {
    throw DioException(
      requestOptions: options,
      type: DioExceptionType.connectionTimeout,
      message: 'connection timeout',
    );
  }

  @override
  void close({bool force = false}) {}
}
