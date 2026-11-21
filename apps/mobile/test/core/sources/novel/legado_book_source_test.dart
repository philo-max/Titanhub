import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/novel/legado_book_source.dart';
import 'package:titanhub/core/sources/novel/legado_store.dart';

void main() {
  test('LegadoRuleRunner parses Legado JSON and executes search, chapters, and content', () async {
    const rawJson = '''
    [
      {
        "bookSourceName": "测试轻小说",
        "bookSourceUrl": "https://novel.test",
        "searchUrl": "/search?q={{key}}",
        "ruleSearch": {
          "bookList": ".book-item",
          "name": "a.title@text",
          "bookUrl": "a.title@href",
          "coverUrl": "img@src",
          "intro": ".intro@text"
        },
        "ruleToc": {
          "chapterList": "#toc li a",
          "chapterName": "@text",
          "chapterUrl": "@href"
        },
        "ruleContent": {
          "content": "#chapter-body@html##广告内容##"
        }
      }
    ]
    ''';

    final sources = LegadoBookSource.parseList(rawJson);
    expect(sources.length, 1);
    final source = sources.first;

    final dio = Dio();
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      final path = options.uri.path;
      if (path == '/search') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '''
            <div class="book-item">
              <a class="title" href="/book/1">魔法禁书目录</a>
              <img src="/cover/1.jpg" />
              <p class="intro">电击文库名作</p>
            </div>
          ''',
        ));
        return;
      }
      if (path == '/book/1') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '<ul id="toc"><li><a href="/book/1/ch1">第一章 学园都市</a></li></ul>',
        ));
        return;
      }
      if (path == '/book/1/ch1') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '<div id="chapter-body"><p>第一段正文。</p><p>广告内容第二段。</p></div>',
        ));
        return;
      }
      handler.reject(DioException(requestOptions: options));
    }));

    final runner = LegadoRuleRunner(source: source, dio: dio);
    final results = await runner.search('魔法');
    expect(results.single['title'], '魔法禁书目录');
    expect(results.single['id'], 'https://novel.test/book/1');
    expect(results.single['cover'], 'https://novel.test/cover/1.jpg');

    final chapters = await runner.getChapters('https://novel.test/book/1');
    expect(chapters.single['title'], '第一章 学园都市');
    expect(chapters.single['id'], 'https://novel.test/book/1/ch1');

    final content = await runner.getContent('https://novel.test/book/1/ch1');
    expect(content, '第一段正文。\n\n第二段。');
  });

  test('LegadoRuleRunner resolves relative chapter URLs against current TOC page URL', () async {
    const source = LegadoBookSource(
      name: '相对路径书源',
      baseUrl: 'https://novel.test',
      searchUrl: '/search?q={{key}}',
      ruleSearch: LegadoSearchRule(bookList: '.b', name: 'a@text', bookUrl: 'a@href'),
      ruleToc: LegadoTocRule(chapterList: '#toc a', chapterName: '@text', chapterUrl: '@href'),
      contentRule: '#body@text',
    );
    final dio = Dio();
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      if (options.uri.toString() == 'https://novel.test/book/42/index.html') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '<div id="toc"><a href="chapter1.html">第一章</a></div>',
        ));
        return;
      }
      handler.reject(DioException(requestOptions: options));
    }));

    final runner = LegadoRuleRunner(source: source, dio: dio);
    final chapters = await runner.getChapters('https://novel.test/book/42/index.html');
    expect(chapters.single['id'], 'https://novel.test/book/42/chapter1.html');
  });

  test('LegadoStore persists and deduplicates sources by stableId across reloads', () async {
    final tempDir = await Directory.systemTemp.createTemp('titanhub_legado_test_');
    addTearDown(() => tempDir.delete(recursive: true));

    final store = LegadoStore(directoryProvider: () async => tempDir);
    const s1 = LegadoBookSource(
      name: '测试源A',
      baseUrl: 'https://a.example.com',
      searchUrl: '/s?q={{key}}',
      ruleSearch: LegadoSearchRule(bookList: '.i', name: 'a@text', bookUrl: 'a@href'),
      ruleToc: LegadoTocRule(chapterList: 'li a', chapterName: '@text', chapterUrl: '@href'),
      contentRule: '#c@text',
    );
    const s1Updated = LegadoBookSource(
      name: '测试源A',
      baseUrl: 'https://a.example.com',
      searchUrl: '/search?q={{key}}',
      ruleSearch: LegadoSearchRule(bookList: '.i', name: 'a@text', bookUrl: 'a@href'),
      ruleToc: LegadoTocRule(chapterList: 'li a', chapterName: '@text', chapterUrl: '@href'),
      contentRule: '#content@text',
    );

    expect(s1.stableId, s1Updated.stableId);
    await store.upsertAll([s1]);
    await store.upsertAll([s1Updated]);

    final reloaded = await store.loadAll();
    expect(reloaded.length, 1);
    expect(reloaded.single.contentRule, '#content@text');

    await store.removeById(s1.stableId);
    expect(await store.loadAll(), isEmpty);
  });
}
