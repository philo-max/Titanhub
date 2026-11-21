import 'package:dio/dio.dart';
import 'package:html/parser.dart' as html_parser;

/// Built-in Mainland-reachable Chinese light novel source (`www.linovelib.com`)
/// covering Dengeki Bunko, Kadokawa, GA Bunko, MF Bunko J, etc.
class LinovelibSource {
  LinovelibSource({Dio? dio})
      : _dio = dio ??
            Dio(BaseOptions(
              baseUrl: baseUrl,
              connectTimeout: const Duration(seconds: 12),
              receiveTimeout: const Duration(seconds: 15),
              headers: const {
                'User-Agent':
                    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
                'Referer': 'https://www.linovelib.com/',
              },
              responseType: ResponseType.plain,
            ));

  static const String pluginId = 'linovelib';
  static const String sourceName = '哔哩轻小说';
  static const String baseUrl = 'https://www.linovelib.com';

  static const int maxChapterPages = 30;
  static const Duration _exploreCacheTtl = Duration(minutes: 5);

  final Dio _dio;
  List<Map<String, dynamic>>? _exploreCache;
  DateTime? _exploreCachedAt;

  Future<dynamic> call(String method, List<dynamic> args) async {
    switch (method) {
      case 'explore':
        return explore();
      case 'search':
        return search(args.isEmpty ? '' : '${args.first}');
      case 'getDetail':
        return getDetail('${args.first}');
      case 'getChapters':
        return getChapters('${args.first}');
      case 'getContent':
        return getContent('${args.first}');
      default:
        throw UnsupportedError('LinovelibSource 不支持方法：$method');
    }
  }

  static String _resolveUrl(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    if (trimmed.startsWith('//')) return 'https:$trimmed';
    return '$baseUrl${trimmed.startsWith('/') ? '' : '/'}$trimmed';
  }

  static String? _extractNovelId(String href) {
    final m = RegExp(r'/novel/(\d+)\.html').firstMatch(href);
    return m?.group(1);
  }

  static List<Map<String, dynamic>> parseListHtml(String html) {
    final doc = html_parser.parse(html);
    final out = <Map<String, dynamic>>[];
    final seen = <String>{};

    // Primary layout on /S6/: sibling .se-result-book + .se-result-infos pairs
    final infoBlocks = doc.querySelectorAll('.se-result-infos');
    final imgBlocks = doc.querySelectorAll('.se-result-book');
    for (var i = 0; i < infoBlocks.length; i++) {
      final info = infoBlocks[i];
      final link = info.querySelector('h2.tit a') ?? info.querySelector('a[href*="/novel/"]');
      if (link == null) continue;
      final id = _extractNovelId(link.attributes['href'] ?? '');
      if (id == null || !seen.add(id)) continue;
      final title = link.text.trim();
      if (title.isEmpty) continue;

      String cover = '';
      // Prefer structurally coupled sibling/parent cover container over blind index matching
      final prev = info.previousElementSibling;
      final imgEl = (prev != null && prev.classes.contains('se-result-book')
              ? prev.querySelector('img')
              : null) ??
          info.querySelector('img') ??
          (imgBlocks.length == infoBlocks.length ? imgBlocks[i].querySelector('img') : null);
      if (imgEl != null) {
        cover = _resolveUrl(imgEl.attributes['data-original'] ?? imgEl.attributes['src'] ?? '');
      }
      if (cover.contains('book-cover-no')) cover = '';

      final intro = info.querySelector('p')?.text.trim() ?? '';
      final metaText = info.querySelector('.bookinfo')?.text.replaceAll(RegExp(r'\s+'), ' ').trim() ?? '';
      out.add({
        'id': id,
        'title': title,
        'cover': cover,
        'description': intro.isNotEmpty ? intro : metaText,
      });
    }

    if (out.isNotEmpty) return out;

    // Fallback generic link scan
    for (final a in doc.querySelectorAll('a[href*="/novel/"]')) {
      final id = _extractNovelId(a.attributes['href'] ?? '');
      if (id == null || !seen.add(id)) continue;
      final title = a.text.trim();
      if (title.length < 2) continue;
      out.add({
        'id': id,
        'title': title,
        'cover': '',
        'description': '',
      });
    }
    return out;
  }

  Future<List<Map<String, dynamic>>> explore({bool forceRefresh = false}) async {
    final cached = _exploreCache;
    final cachedAt = _exploreCachedAt;
    if (!forceRefresh &&
        cached != null &&
        cachedAt != null &&
        DateTime.now().difference(cachedAt) < _exploreCacheTtl) {
      return cached;
    }
    final res = await _dio.get<String>('/S6/');
    final items = parseListHtml(res.data ?? '');
    if (items.isNotEmpty) {
      _exploreCache = items;
      _exploreCachedAt = DateTime.now();
    }
    return items;
  }

  static bool _looksBlockedHtml(String html) {
    final lower = html.toLowerCase();
    return lower.contains('cf-browser-verification') ||
        lower.contains('just a moment') ||
        html.contains('安全验证') ||
        html.contains('访问过于频繁');
  }

  Future<List<Map<String, dynamic>>> search(String rawQuery) async {
    final q = rawQuery.replaceFirst(RegExp(r'^tag:'), '').trim();
    if (q.isEmpty) return explore();

    // 1. Try POST /S6/ (desktop/mobile form endpoint)
    try {
      final res = await _dio.post<String>(
        '/S6/',
        data: {'searchkey': q},
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          headers: const {'Referer': 'https://www.linovelib.com/S6/'},
        ),
      );
      final body = res.data ?? '';
      if (!_looksBlockedHtml(body)) {
        final parsed = parseListHtml(body);
        if (parsed.isNotEmpty) return parsed;
      }
    } catch (_) {}

    // 2. Try GET /S6/?searchkey=...
    try {
      final res = await _dio.get<String>(
        '/S6/',
        queryParameters: {'searchkey': q},
        options: Options(
          headers: const {'Referer': 'https://www.linovelib.com/S6/'},
        ),
      );
      final body = res.data ?? '';
      if (!_looksBlockedHtml(body)) {
        final parsed = parseListHtml(body);
        if (parsed.isNotEmpty) return parsed;
      }
    } catch (_) {}

    // 3. Fall back to filtering cached /S6/ catalog
    final catalog = await explore();
    final lower = q.toLowerCase();
    return [
      for (final item in catalog)
        if ('${item['title']} ${item['description']}'.toLowerCase().contains(lower))
          item,
    ];
  }

  static bool _isUiGenreNoise(String raw) {
    final t = raw.trim();
    if (t.isEmpty || t.length > 14) return true;
    if (t.contains('|') || t.contains('｜')) return true;
    const blocked = {
      '正序',
      '倒序',
      '更多',
      '展开',
      '收起',
      '连载',
      '完结',
      '已完结',
      '连载中',
      '全部',
      '目录',
    };
    return blocked.contains(t);
  }

  Future<Map<String, dynamic>> getDetail(String mediaId) async {
    final id = mediaId.trim();
    final res = await _dio.get<String>('/novel/$id.html');
    final doc = html_parser.parse(res.data ?? '');

    final title = doc.querySelector('h1.book-name')?.text.trim() ??
        doc.querySelector('meta[property="og:title"]')?.attributes['content']?.trim() ??
        doc.querySelector('title')?.text.split('_').first.trim() ??
        id;
    final coverRaw = doc.querySelector('.book-img img')?.attributes['data-original'] ??
        doc.querySelector('.book-img img')?.attributes['src'] ??
        doc.querySelector('meta[property="og:image"]')?.attributes['content'] ??
        '';
    final description = doc.querySelector('.book-dec p')?.text.trim() ??
        doc.querySelector('meta[property="og:description"]')?.attributes['content']?.trim() ??
        '';
    final author = doc.querySelector('.au-name a')?.text.trim() ??
        doc.querySelector('meta[property="og:novel:author"]')?.attributes['content']?.trim();

    final seenGenres = <String>{};
    final genres = <String>[];
    for (final el in doc.querySelectorAll('.book-label a, .book-label span')) {
      final raw = el.text.replaceAll(RegExp(r'\s+'), '').trim();
      if (_isUiGenreNoise(raw)) continue;
      if (seenGenres.add(raw)) {
        genres.add(raw);
      }
    }

    return {
      'id': id,
      'title': title,
      'cover': _resolveUrl(coverRaw),
      'description': description,
      if (author != null && author.isNotEmpty) 'author': author,
      'genres': genres,
    };
  }

  Future<List<Map<String, dynamic>>> getChapters(String mediaId) async {
    final id = mediaId.trim();
    final res = await _dio.get<String>('/novel/$id/catalog');
    final doc = html_parser.parse(res.data ?? '');
    final chapters = <Map<String, dynamic>>[];
    final seen = <String>{};
    final pattern = RegExp('/novel/$id/(\\d+)\\.html');

    for (final a in doc.querySelectorAll('a[href]')) {
      final href = a.attributes['href'] ?? '';
      final m = pattern.firstMatch(href);
      if (m == null) continue;
      final cid = m.group(1)!;
      final chapterKey = '$id/$cid';
      if (!seen.add(chapterKey)) continue;
      final title = a.text.trim();
      if (title.isEmpty) continue;
      chapters.add({
        'id': chapterKey,
        'title': title,
        'chapterNo': chapters.length + 1,
      });
    }
    return chapters;
  }

  static bool _isNoiseParagraph(String text) {
    return text.contains('內容加載失敗') ||
        text.contains('内容加载失败') ||
        text.contains('請刷新或更換瀏覽器') ||
        text.contains('请刷新或更换浏览器');
  }

  static List<String> _extractParagraphs(String html) {
    final doc = html_parser.parse(html);
    final container = doc.querySelector('#TextContent') ?? doc.querySelector('.TextContent');
    if (container == null) return const [];
    final paragraphs = <String>[];

    // Extract inline illustration markers and text paragraphs in document order
    for (final el in container.querySelectorAll('p, img')) {
      if (el.localName == 'img') {
        final src = (el.attributes['data-src'] ??
                el.attributes['data-original'] ??
                el.attributes['src'] ??
                '')
            .trim();
        final resolved = _resolveUrl(src);
        if (resolved.isNotEmpty &&
            !resolved.contains('book-cover-no') &&
            !resolved.endsWith('.svg')) {
          paragraphs.add('[IMG:$resolved]');
        }
        continue;
      }
      final t = el.text
          .replaceAll(RegExp(r'（?(?:內容加載失敗|内容加载失败)[^）\n]*）?'), '')
          .trim();
      if (t.isNotEmpty && !_isNoiseParagraph(t)) {
        paragraphs.add(t);
      }
    }
    if (paragraphs.isNotEmpty) return paragraphs;
    final raw = container.text
        .replaceAll(RegExp(r'（?(?:內容加載失敗|内容加载失败)[^）\n]*）?'), '')
        .replaceAll(RegExp(r'\r\n?'), '\n')
        .replaceAll(RegExp(r'\n{3,}'), '\n\n')
        .trim();
    return raw.isEmpty ? const [] : [raw];
  }

  Future<String> getContent(String chapterId) async {
    final normalized = chapterId.trim();
    final initialPath = normalized.startsWith('http')
        ? normalized
        : (normalized.endsWith('.html')
            ? (normalized.startsWith('/') ? normalized : '/novel/$normalized')
            : '/novel/$normalized.html');

    final idMatch = RegExp(r'/novel/(\d+)/(\d+)(?:_\d+)?\.html').firstMatch(initialPath);
    final novelId = idMatch?.group(1);
    final baseCid = idMatch?.group(2);

    final allParagraphs = <String>[];
    final visited = <String>{};
    String? nextPath = initialPath;

    for (var page = 0; page < maxChapterPages && nextPath != null; page++) {
      if (!visited.add(nextPath)) break;
      final res = await _dio.get<String>(nextPath);
      final html = res.data ?? '';
      final paras = _extractParagraphs(html);
      if (page == 0 && paras.isEmpty) {
        throw StateError('未找到小说正文区域（可能触发站点验证）');
      }
      allParagraphs.addAll(paras);

      nextPath = null;
      if (novelId != null && baseCid != null) {
        final nextPageNum = page + 2;
        final subPattern = RegExp('/novel/$novelId/${baseCid}_$nextPageNum\\.html');
        final m = subPattern.firstMatch(html);
        if (m != null) {
          nextPath = m.group(0);
        }
      }
    }
    return allParagraphs.join('\n\n');
  }

  void dispose() {
    _dio.close(force: true);
  }
}
