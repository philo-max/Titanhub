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

  final Dio _dio;

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
      if (i < imgBlocks.length) {
        final img = imgBlocks[i].querySelector('img');
        if (img != null) {
          cover = _resolveUrl(img.attributes['data-original'] ?? img.attributes['src'] ?? '');
        }
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

  Future<List<Map<String, dynamic>>> explore() async {
    final res = await _dio.get<String>('/S6/');
    return parseListHtml(res.data ?? '');
  }

  Future<List<Map<String, dynamic>>> search(String rawQuery) async {
    final q = rawQuery.replaceFirst(RegExp(r'^tag:'), '').trim();
    if (q.isEmpty) return explore();

    try {
      final res = await _dio.post<String>(
        '/S6/',
        data: {'searchkey': q},
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          headers: const {'Referer': 'https://www.linovelib.com/S6/'},
        ),
      );
      final parsed = parseListHtml(res.data ?? '');
      if (parsed.isNotEmpty) return parsed;
    } catch (_) {
      // Fall back to filtering live /S6/ catalog below.
    }

    final catalog = await explore();
    final lower = q.toLowerCase();
    return [
      for (final item in catalog)
        if ('${item['title']} ${item['description']}'.toLowerCase().contains(lower))
          item,
    ];
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
    final genres = <String>[
      for (final el in doc.querySelectorAll('.book-label a, .book-label span'))
        if (el.text.trim().isNotEmpty) el.text.trim(),
    ];

    return {
      'id': id,
      'title': title,
      'cover': _resolveUrl(coverRaw),
      'description': description,
      if (author != null && author.isNotEmpty) 'author': author,
      'genres': genres.toSet().toList(),
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

  Future<String> getContent(String chapterId) async {
    final normalized = chapterId.trim();
    final path = normalized.startsWith('http')
        ? normalized
        : (normalized.endsWith('.html')
            ? (normalized.startsWith('/') ? normalized : '/novel/$normalized')
            : '/novel/$normalized.html');
    final res = await _dio.get<String>(path);
    final doc = html_parser.parse(res.data ?? '');
    final container = doc.querySelector('#TextContent') ?? doc.querySelector('.TextContent');
    if (container == null) {
      throw StateError('未找到小说正文区域（可能触发站点验证）');
    }
    final paragraphs = [
      for (final p in container.querySelectorAll('p'))
        if (p.text.trim().isNotEmpty) p.text.trim(),
    ];
    if (paragraphs.isNotEmpty) {
      return paragraphs.join('\n\n');
    }
    return container.text
        .replaceAll(RegExp(r'\r\n?'), '\n')
        .replaceAll(RegExp(r'\n{3,}'), '\n\n')
        .trim();
  }

  void dispose() {
    _dio.close(force: true);
  }
}
