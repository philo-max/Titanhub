import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/novel/linovelib_source.dart';

void main() {
  test('LinovelibSource parses S6 explore, catalog chapters, and TextContent body', () async {
    final dio = Dio(BaseOptions(baseUrl: LinovelibSource.baseUrl, responseType: ResponseType.plain));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      final path = options.uri.path;
      if (path == '/S6/') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '''
            <div class="imgbox fl se-result-book">
              <a href="/novel/2906.html">
                <img src="/themes/zhpc/images/book-cover-no.svg" data-original="https://www.linovelib.com/files/article/image/2/2906/2906s.jpg">
              </a>
            </div>
            <div class="fl se-result-infos">
              <h2 class="tit"><a href="/novel/2906.html">魔法禁书目录</a></h2>
              <div class="bookinfo"><a>镰池和马</a><em>|</em><a>电击文库</a></div>
              <p>学园都市的超能力故事。</p>
            </div>
          ''',
        ));
        return;
      }
      if (path == '/novel/2906/catalog') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '''
            <ul class="chapter-list">
              <li><a href="/novel/2906/242200.html">序章</a></li>
              <li><a href="/novel/2906/242201.html">第一章</a></li>
            </ul>
          ''',
        ));
        return;
      }
      if (path == '/novel/2906/242200.html') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '''
            <div id="TextContent" class="TextContent">
              <p>「欢迎来到学园都市。」</p>
              <p>第一页末尾（內容加載失敗！請刷新或更換瀏覽器）</p>
            </div>
            <script>var url_next="/novel/2906/242200_2.html";</script>
          ''',
        ));
        return;
      }
      if (path == '/novel/2906/242200_2.html') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '''
            <div id="TextContent" class="TextContent">
              <p>第二页继续展开。</p>
            </div>
          ''',
        ));
        return;
      }
      handler.reject(DioException(requestOptions: options));
    }));

    final src = LinovelibSource(dio: dio);
    final items = await src.explore();
    expect(items.length, 1);
    expect(items.first['id'], '2906');
    expect(items.first['title'], '魔法禁书目录');
    expect(items.first['cover'], 'https://www.linovelib.com/files/article/image/2/2906/2906s.jpg');

    final chapters = await src.getChapters('2906');
    expect(chapters.length, 2);
    expect(chapters.first['id'], '2906/242200');
    expect(chapters.first['title'], '序章');

    final text = await src.getContent('2906/242200');
    expect(text, '「欢迎来到学园都市。」\n\n第一页末尾\n\n第二页继续展开。');
  });

  test('LinovelibSource filters junk/duplicate genres and parses illustration chapters', () async {
    final dio = Dio(BaseOptions(baseUrl: LinovelibSource.baseUrl, responseType: ResponseType.plain));
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      final path = options.uri.path;
      if (path == '/novel/3001.html') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '''
            <h1 class="book-name">青春猪头少年</h1>
            <div class="book-label">
              <a href="#">青春</a>
              <span>青春</span>
              <span>恋爱</span>
              <span>倒序|正序</span>
              <span>|</span>
              <span>连载中</span>
            </div>
          ''',
        ));
        return;
      }
      if (path == '/novel/3001/999.html') {
        handler.resolve(Response(
          requestOptions: options,
          statusCode: 200,
          data: '''
            <div id="TextContent">
              <img class="imagecontent" data-src="https://img3.readpai.com/3/3001/01.jpg" />
            </div>
          ''',
        ));
        return;
      }
      handler.reject(DioException(requestOptions: options));
    }));

    final src = LinovelibSource(dio: dio);
    final detail = await src.getDetail('3001');
    expect(detail['genres'], ['青春', '恋爱']);

    final illusContent = await src.getContent('3001/999');
    expect(illusContent, '[IMG:https://img3.readpai.com/3/3001/01.jpg]');
  });

  test('LinovelibSource.parseListHtml couples cover by sibling container instead of blind index', () {
    const html = '''
      <div class="se-result-infos">
        <h2 class="tit"><a href="/novel/100.html">无图作品</a></h2>
      </div>
      <div class="se-result-book">
        <img data-original="https://www.linovelib.com/files/article/image/2/200/200s.jpg">
      </div>
      <div class="se-result-infos">
        <h2 class="tit"><a href="/novel/200.html">有图作品</a></h2>
      </div>
    ''';
    final items = LinovelibSource.parseListHtml(html);
    expect(items.length, 2);
    expect(items[0]['id'], '100');
    expect(items[0]['cover'], '');
    expect(items[1]['id'], '200');
    expect(items[1]['cover'], 'https://www.linovelib.com/files/article/image/2/200/200s.jpg');
  });
}
