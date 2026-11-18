import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_rule.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_source.dart';

import 'kazumi_test_support.dart';

KazumiSource ezdmw(FakeHandler handler, {Map<String, dynamic>? override}) {
  final raw = {...bundledRuleJson('ezdmw'), ...?override};
  return KazumiSource(KazumiRule.fromJson(raw), dio: fakeDio(handler), retryDelays: const [Duration.zero, Duration.zero]);
}

DioException timeout(String url) => DioException(
      requestOptions: RequestOptions(path: url),
      type: DioExceptionType.connectionTimeout,
    );

void main() {
  group('XPath 搜索', () {
    test('解析标题与链接，id 为 encodeURIComponent(href)，跳过无效节点并去重', () async {
      final source = ezdmw((o) => FakeReply(fixture('ezdmw_search.html')));
      final results = await source.search('芙莉莲');
      expect(results.map((e) => e['title']), ['葬送的 芙莉莲', 'Frieren Extra']);
      expect(results.map((e) => e['id']), [
        Uri.encodeComponent('/Index/detail/12.html'),
        Uri.encodeComponent('https://m.ezdmw.org/Index/detail/13.html'),
      ]);
    });

    test('搜索结果从节点内取封面并补全相对地址，没有图片时为空', () async {
      final source = ezdmw((o) => FakeReply(fixture('ezdmw_search.html')));
      final results = await source.search('芙莉莲');
      expect(results.map((e) => e['cover']), ['https://m.ezdmw.org/p/12.jpg', '']);
    });

    test('请求地址含编码关键词与规则请求头', () async {
      final adapter = FakeAdapter((o) => FakeReply(fixture('ezdmw_search.html')));
      final source = KazumiSource(bundledRule('ezdmw'), dio: fakeDio((o) => throw 1, adapter: adapter));
      await source.search('芙莉莲 2');
      final call = adapter.calls.single;
      expect(call.uri.toString(),
          'https://m.ezdmw.org/Index/search.html?searchText=${Uri.encodeComponent('芙莉莲 2')}');
      expect(call.headers['Referer'], 'https://m.ezdmw.org/');
      expect(call.headers['User-Agent'], KazumiSource.defaultUserAgent);
    });

    test('零结果是真实空列表', () async {
      final source = ezdmw((o) => FakeReply(fixture('ezdmw_no_results.html')));
      expect(await source.search('不存在'), isEmpty);
    });

    test('结构变化时报解析失败而不是假空结果', () async {
      final source = ezdmw((o) => FakeReply(fixture('ezdmw_changed_structure.html')));
      await expectLater(
        source.search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('搜索页解析失败'))),
      );
    });

    test('403 返回明确拒绝访问错误', () async {
      final source = ezdmw((o) => const FakeReply('denied', status: 403));
      await expectLater(
        source.search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('HTTP 403'))),
      );
    });

    test('5xx 与超时与网络不可达分别报错', () async {
      await expectLater(
        ezdmw((o) => const FakeReply('x', status: 503)).search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('HTTP 503'))),
      );
      await expectLater(
        ezdmw((o) => FakeReply('', error: timeout(o.uri.toString()))).search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('超时'))),
      );
      await expectLater(
        ezdmw((o) => FakeReply('', error: DioException(
              requestOptions: o,
              type: DioExceptionType.connectionError,
            ))).search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('不可达'))),
      );
    });

    test('空响应与无效 XPath 报错', () async {
      await expectLater(
        ezdmw((o) => const FakeReply('')).search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('内容为空'))),
      );
      await expectLater(
        ezdmw((o) => FakeReply(fixture('ezdmw_search.html')), override: {'searchList': 'foo('}).search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('XPath'))),
      );
    });

    test('人机验证页明确报错', () async {
      final source = ezdmw(
        (o) => FakeReply(fixture('ezdmw_captcha.html')),
        override: {
          'antiCrawlerConfig': {
            'enabled': true,
            'captchaDetectType': 1,
            'captchaDetectValue': "//form[contains(@action,'/captcha/verify')]",
          },
        },
      );
      await expectLater(
        source.search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('人机验证'))),
      );
    });

    test('空关键词不发请求', () async {
      final adapter = FakeAdapter((o) => const FakeReply(''));
      final source = KazumiSource(bundledRule('ezdmw'), dio: fakeDio((o) => throw 1, adapter: adapter));
      expect(await source.search('  '), isEmpty);
      expect(adapter.calls, isEmpty);
    });
  });

  group('XPath 详情与章节', () {
    final mediaId = Uri.encodeComponent('/Index/detail/12.html');

    test('详情取标题、封面、简介', () async {
      final source = ezdmw((o) => FakeReply(fixture('ezdmw_detail.html')));
      final detail = await source.getDetail(mediaId);
      expect(detail['id'], mediaId);
      expect(detail['title'], '葬送的芙莉莲');
      expect(detail['cover'], 'https://m.ezdmw.org/p/12.jpg');
      expect(detail['description'], '魔王被打倒之后的故事。');
    });

    test('同域 http 详情地址请求时升级为 https，id 保持不变', () async {
      final adapter = FakeAdapter((o) => FakeReply(fixture('ezdmw_detail.html')));
      final source = KazumiSource(bundledRule('ezdmw'), dio: fakeDio((o) => throw 1, adapter: adapter));
      final httpId = Uri.encodeComponent('http://m.ezdmw.org/Index/detail/12.html');
      final detail = await source.getDetail(httpId);
      expect(detail['id'], httpId);
      expect(adapter.calls.single.uri.toString(), 'https://m.ezdmw.org/Index/detail/12.html');
    });

    test('多线路章节：id 编码、lineId/groupId 约定与桌面一致', () async {
      final adapter = FakeAdapter((o) => FakeReply(fixture('ezdmw_detail.html')));
      final source = KazumiSource(bundledRule('ezdmw'), dio: fakeDio((o) => throw 1, adapter: adapter));
      final chapters = await source.getChapters(mediaId);
      expect(adapter.calls.single.uri.toString(), 'https://m.ezdmw.org/Index/detail/12.html');
      expect(chapters.map((c) => c['id']), [
        Uri.encodeComponent('/play/12-1-1.html'),
        Uri.encodeComponent('/play/12-1-2.html'),
        Uri.encodeComponent('/play/12-2-1.html'),
      ]);
      expect(chapters.map((c) => c['title']), ['第1集', '第2集', '第1集']);
      expect(chapters.map((c) => c['chapterNo']), [1, 2, 1]);
      expect(chapters.map((c) => c['groupId']), ['line-1', 'line-1', 'line-2']);
      expect(chapters.map((c) => c['groupName']), ['线路1', '线路1', '线路2']);
      expect(chapters.map((c) => c['lineId']), ['line-1', 'line-1', 'line-2']);
    });

    test('线路存在但没有剧集时报错', () async {
      final source = ezdmw((o) => FakeReply(fixture('ezdmw_empty_roads.html')));
      await expectLater(
        source.getChapters(mediaId),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('未解析到任何剧集'))),
      );
    });

    test('详情页 404 报错', () async {
      final source = ezdmw((o) => const FakeReply('nf', status: 404));
      await expectLater(
        source.getChapters(mediaId),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('HTTP 404'))),
      );
    });
  });

  group('播放地址', () {
    test('播放页返回 page 类型与请求头，交给 WebView 嗅探', () async {
      final source = ezdmw((o) => throw 1);
      final result = await source.getVideoUrl(Uri.encodeComponent('/play/12-1-1.html'));
      expect(result.single['type'], 'page');
      expect(result.single['url'], 'https://m.ezdmw.org/play/12-1-1.html');
      final headers = result.single['headers'] as Map<String, String>;
      expect(headers['Referer'], 'https://m.ezdmw.org/');
      expect(headers['User-Agent'], isNotEmpty);
    });

    test('直链媒体返回 file 类型', () async {
      final source = ezdmw((o) => throw 1);
      final result = await source.getVideoUrl(Uri.encodeComponent('https://cdn.x.com/a/b.m3u8?t=1'));
      expect(result.single['type'], 'file');
      expect(result.single['url'], 'https://cdn.x.com/a/b.m3u8?t=1');
    });

    test('拒绝非 HTTP(S) 地址', () async {
      final source = ezdmw((o) => throw 1);
      await expectLater(
        source.getVideoUrl(Uri.encodeComponent('javascript:alert(1)')),
        throwsA(isA<KazumiSourceException>()),
      );
    });

    test('call 分发与未知方法', () async {
      final source = ezdmw((o) => throw 1);
      expect(await source.call('getVideoUrl', [Uri.encodeComponent('/p/1.html')]), isNotEmpty);
      await expectLater(source.call('nope', []), throwsA(isA<KazumiSourceException>()));
      await expectLater(source.call('search', []), throwsA(isA<KazumiSourceException>()));
      source.dispose();
      await expectLater(source.call('search', ['x']), throwsA(isA<KazumiSourceException>()));
    });
  });

  group('API 模式', () {
    test('规则未配置 coverPath 时回退取 vod_pic 并补全地址', () async {
      final reply = jsonEncode({
        'info': {
          'rows': [
            {'vod_id': 26879, 'vod_name': '葬送的芙莉莲 第二季', 'vod_pic': '/upload/a.webp'},
            {'vod_id': 25524, 'vod_name': '葬送的芙莉莲'},
          ],
        },
      });
      final source = KazumiSource(bundledRule('giriGiriLove'), dio: fakeDio((o) => FakeReply(reply)));
      final results = await source.search('芙莉莲');
      expect(results.map((e) => e['cover']), ['https://ani.girigirilove.com/upload/a.webp', '']);
    });

    test('分隔格式章节：giriGiriLove 规则', () async {
      final calls = <String>[];
      final source = KazumiSource(
        bundledRule('giriGiriLove'),
        dio: fakeDio((o) {
          calls.add(o.uri.toString());
          if (o.uri.path.endsWith('get_list')) {
            return FakeReply(jsonEncode({
              'info': {
                'rows': [
                  {'vod_id': 7, 'vod_name': '测试番'},
                  {'vod_id': 8, 'vod_name': ''},
                ],
              },
            }));
          }
          return FakeReply(jsonEncode({
            'info': {
              'vod_play_from': '线路A\$\$\$线路B',
              'vod_play_url':
                  '第1集\$https://v.x/a/1.html#第2集\$/a/2.html\$\$\$第1集\$https://v.x/b/1.html',
            },
          }));
        }),
      );
      final results = await source.search('测试');
      expect(results.single['id'], '7');
      expect(calls.first, contains('vod_name=${Uri.encodeComponent('测试')}'));
      final chapters = await source.getChapters('7');
      expect(chapters.map((c) => c['id']), [
        Uri.encodeComponent('https://v.x/a/1.html'),
        Uri.encodeComponent('https://ani.girigirilove.com/a/2.html'),
        Uri.encodeComponent('https://v.x/b/1.html'),
      ]);
      expect(chapters.map((c) => c['groupName']), ['线路A', '线路A', '线路B']);
      expect(chapters.map((c) => c['groupId']), ['line-1', 'line-1', 'line-2']);
      expect(chapters.map((c) => c['chapterNo']), [1, 2, 1]);
      final detail = await source.getDetail('7');
      expect(detail['title'], '测试番');
    });

    test('嵌套格式 + episodePage：sorani 规则，单线路无分组', () async {
      final source = KazumiSource(
        bundledRule('sorani'),
        dio: fakeDio((o) => FakeReply(jsonEncode({
              'data': {
                'episodes': [
                  {'episodeLabel': '第1话', 'episodeOrder': 1},
                  {'episodeLabel': '', 'episodeOrder': 2},
                ],
              },
            }))),
      );
      final chapters = await source.getChapters('52991');
      expect(chapters.map((c) => c['id']), [
        Uri.encodeComponent('https://www.sorani.net/anime/mal/52991/episode/1'),
        Uri.encodeComponent('https://www.sorani.net/anime/mal/52991/episode/2'),
      ]);
      expect(chapters.map((c) => c['title']), ['第1话', '第 2 话']);
      expect(chapters.first.containsKey('groupId'), isFalse);
    });

    test('sourceTemplate 生成详情页地址并走 XPath 章节：LMM 规则', () async {
      final source = KazumiSource(
        bundledRule('LMM'),
        dio: fakeDio((o) {
          if (o.uri.path.contains('suggest')) {
            return FakeReply(jsonEncode({
              'list': [
                {'id': 321, 'name': '某番'},
              ],
            }));
          }
          return const FakeReply(
            '<html><body><div class="module-player-list"><a href="/index.php/vod/play/id/321/sid/1/nid/1.html">1</a>'
            '<a href="/index.php/vod/play/id/321/sid/1/nid/2.html">2</a></div></body></html>',
          );
        }),
      );
      final results = await source.search('某');
      expect(results.single['id'],
          Uri.encodeComponent('https://www.lmm85.com/index.php/vod/detail/id/321.html'));
      final chapters = await source.getChapters(results.single['id'] as String);
      expect(chapters.map((c) => c['id']), [
        Uri.encodeComponent('/index.php/vod/play/id/321/sid/1/nid/1.html'),
        Uri.encodeComponent('/index.php/vod/play/id/321/sid/1/nid/2.html'),
      ]);
    });

    test('接口返回非 JSON 或 HTTP 错误时报错', () async {
      await expectLater(
        KazumiSource(bundledRule('giriGiriLove'), dio: fakeDio((o) => const FakeReply('<html>'))).search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('不是 JSON'))),
      );
      await expectLater(
        KazumiSource(bundledRule('giriGiriLove'), dio: fakeDio((o) => const FakeReply('x', status: 500)))
            .search('x'),
        throwsA(isA<KazumiSourceException>().having((e) => e.message, 'message', contains('HTTP 500'))),
      );
    });

    test('POST + JSON 请求体与自定义头：xfdmnext 规则', () async {
      final adapter = FakeAdapter((o) => const FakeReply('[]'));
      final source = KazumiSource(bundledRule('xfdmnext'), dio: fakeDio((o) => throw 1, adapter: adapter));
      expect(await source.search('x'), isEmpty);
      final call = adapter.calls.single;
      expect(call.method, 'POST');
      expect(call.headers['apikey'], isNotNull);
      expect(call.data, contains('"search_term":"x"'));
    });
  });
}
