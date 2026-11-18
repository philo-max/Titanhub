import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:html/dom.dart' show Document, Element, Text;
import 'package:html/parser.dart' as html_parser;

class SevenSeFunSource {
  SevenSeFunSource({Dio? dio})
      : _dio = dio ?? _createDio(),
        _ownsDio = dio == null;

  static const String pluginId = 'kazumi-7sefun';
  static const String sourceName = '七色番动漫';
  static const String origin = 'https://www.7sefun.top';
  static const String userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

  static const String _searchUrlTemplate =
      '$origin/vodsearch/-------------.html?wd=@keyword';

  static const Set<String> _allowedHosts = {'www.7sefun.top', '7sefun.top'};

  static final RegExp _mediaExtension =
      RegExp(r'\.(m3u8|mp4|flv|webm)(?:[?#]|$)', caseSensitive: false);

  final Dio _dio;
  final bool _ownsDio;

  final Map<String, Map<String, String>> _searchCache = {};

  bool _disposed = false;

  static Dio _createDio() {
    return Dio(
      BaseOptions(
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 20),
        sendTimeout: const Duration(seconds: 15),
        followRedirects: true,
        maxRedirects: 5,
        responseType: ResponseType.bytes,
        validateStatus: (_) => true,
        headers: {
          'User-Agent': userAgent,
          'Referer': '$origin/',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      ),
    );
  }

  Future<dynamic> call(String method, List<dynamic> args) async {
    _ensureActive();
    switch (method) {
      case 'search':
        return search(_stringArg(args, 0, 'keyword'));
      case 'getDetail':
        return getDetail(_stringArg(args, 0, 'mediaId'));
      case 'getChapters':
        return getChapters(_stringArg(args, 0, 'mediaId'));
      case 'getVideoUrl':
        return getVideoUrl(_stringArg(args, 0, 'chapterId'));
      default:
        throw SevenSeFunException('七色番来源不支持方法「$method」');
    }
  }

  Future<List<Map<String, dynamic>>> search(String keyword) async {
    final trimmed = keyword.trim();
    if (trimmed.isEmpty) return const <Map<String, dynamic>>[];

    final url = _searchUrlTemplate.replaceAll(
      RegExp(r'@keyword|\{keyword\}'),
      Uri.encodeComponent(trimmed),
    );
    final html = await _fetchHtml(url);
    final document = _parseDocument(html, url);

    final list = document.querySelector('.videos');
    if (list == null && document.querySelector('.main-container') == null) {
      throw SevenSeFunException('七色番搜索页结构无法识别：$url');
    }
    if (list == null) return const <Map<String, dynamic>>[];

    final results = <Map<String, dynamic>>[];
    final seen = <String>{};
    for (final item in list.querySelectorAll('.video')) {
      final anchor = item.querySelector('a.video-wrapper') ??
          item.querySelector('a[href*="/voddetail/"]');
      final rawHref = anchor?.attributes['href']?.trim() ?? '';
      if (rawHref.isEmpty) continue;

      final img = item.querySelector('img');
      final title = _clean(
        item.querySelector('.video-by')?.text ??
            img?.attributes['alt'] ??
            anchor?.attributes['title'] ??
            '',
      );
      if (title.isEmpty) continue;

      final id = Uri.encodeComponent(rawHref);
      if (!seen.add(id)) continue;
      final cover = _absolutize(
        img?.attributes['data-src'] ??
            img?.attributes['data-original'] ??
            img?.attributes['src'] ??
            '',
      );
      if (_searchCache.length >= 200) {
        _searchCache.remove(_searchCache.keys.first);
      }
      _searchCache[id] = {'title': title, 'cover': cover};
      results.add({'id': id, 'title': title, 'cover': cover});
    }
    return results;
  }

  Future<Map<String, dynamic>> getDetail(String mediaId) async {
    final pageUrl = _pageUrlFromId(mediaId, kind: '详情');
    final html = await _fetchHtml(pageUrl, referer: '$origin/');
    final document = _parseDocument(html, pageUrl);

    final nameElement = document.querySelector('.video-p-name');
    var title = _clean(nameElement == null ? '' : _ownText(nameElement))
        .replaceAll(RegExp(r'\s*热度[:：].*$'), '')
        .trim();
    if (title.isEmpty) {
      title = _clean(document.querySelector('meta[property="og:title"]')?.attributes['content'] ?? '');
    }
    if (title.isEmpty) {
      final rawTitle = _clean(document.querySelector('title')?.text ?? '');
      title = rawTitle
          .replaceAll(RegExp(r'^《|》.*$'), '')
          .replaceAll(RegExp(r'\s*[-|].*$'), '')
          .trim();
    }
    if (title.isEmpty) {
      throw SevenSeFunException('七色番详情页解析失败（缺少标题）：$pageUrl');
    }

    final coverElement = document.querySelector('.video-p-wrapper img.author-img') ??
        document.querySelector('.video-p-wrapper img');
    var cover = _absolutize(
      coverElement?.attributes['data-src'] ??
          coverElement?.attributes['data-original'] ??
          coverElement?.attributes['src'] ??
          '',
    );
    if (cover.isEmpty) {
      cover = _absolutize(
        document.querySelector('meta[property="og:image"]')?.attributes['content'] ?? '',
      );
    }

    final subtitle = _clean(document.querySelector('.video-p-subtitle')?.text ?? '');
    var description = subtitle;
    if (description.isEmpty) {
      description = _clean(
        document.querySelector('meta[name="description"]')?.attributes['content'] ??
            document.querySelector('meta[property="og:description"]')?.attributes['content'] ??
            '',
      );
      description = description
          .replaceAll(RegExp(r'剧情[:：]?$'), '')
          .trim();
      if (description == title) description = '';
    }

    final genres = <String>[];
    String? author;
    for (final row in document.querySelectorAll('.video-p-sub1')) {
      final text = _clean(_ownText(row));
      if (text.startsWith('类型：')) {
        for (final genre in text.substring(3).split(RegExp(r'[,，/、]'))) {
          final value = genre.trim();
          if (value.isNotEmpty && !genres.contains(value)) genres.add(value);
        }
      } else if (text.startsWith('导演：') && author == null) {
        final value = text
            .substring(3)
            .trim()
            .replaceAll(RegExp(r'[,，、/\s]+$'), '');
        if (value.isNotEmpty && value != '未知') author = value;
      }
    }

    final status = _extractStatus(document);
    final cached = _searchCache[mediaId];
    if (cover.isEmpty && cached != null) cover = cached['cover'] ?? '';

    return {
      'id': mediaId,
      'title': title,
      'cover': cover,
      'description': description,
      if (status != null) 'status': status,
      if (author != null) 'author': author,
      'genres': genres,
    };
  }

  Future<List<Map<String, dynamic>>> getChapters(String mediaId) async {
    final pageUrl = _pageUrlFromId(mediaId, kind: '详情');
    final html = await _fetchHtml(pageUrl, referer: '$origin/');
    final document = _parseDocument(html, pageUrl);

    if (document.querySelector('.vod-play-list-container') == null) {
      throw SevenSeFunException('七色番详情页解析失败（缺少播放列表）：$pageUrl');
    }

    final groups = <_ChapterGroup>[];
    final headers = document
        .querySelectorAll('.chat-header')
        .where((header) => header.querySelector('.chat-stream-bfq') != null)
        .toList();
    for (var i = 0; i < headers.length; i++) {
      final header = headers[i];
      final name = _clean(header.querySelector('.chat-stream-bfq')?.text ?? '');
      final anchors = <Element>[];
      Element? sibling = header.nextElementSibling;
      while (sibling != null) {
        if (sibling.classes.contains('chat-header') ||
            sibling.querySelector('.chat-stream-bfq') != null) {
          break;
        }
        if (sibling.classes.contains('vod-play-list-container')) {
          anchors.addAll(sibling.querySelectorAll('a[href]'));
        } else {
          anchors.addAll(
            sibling.querySelectorAll('.vod-play-list-container a[href]'),
          );
        }
        sibling = sibling.nextElementSibling;
      }
      if (anchors.isNotEmpty) {
        groups.add(_ChapterGroup(name: name, anchors: anchors));
      }
    }
    if (groups.isEmpty) {
      groups.add(_ChapterGroup(
        name: '',
        anchors: document.querySelectorAll('.vod-play-list-container a[href]'),
      ));
    }

    final multiLine = groups.length > 1;
    final chapters = <Map<String, dynamic>>[];
    for (var lineIndex = 0; lineIndex < groups.length; lineIndex++) {
      final seenIds = <String>{};
      final group = groups[lineIndex];
      final groupId = 'line-${lineIndex + 1}';
      final groupName =
          group.name.isNotEmpty ? group.name : '线路${lineIndex + 1}';
      for (final anchor in group.anchors) {
        final rawHref = anchor.attributes['href']?.trim() ?? '';
        if (rawHref.isEmpty) continue;
        final id = Uri.encodeComponent(rawHref);
        if (!seenIds.add(id)) continue;

        final title = _clean(anchor.attributes['title'] ?? anchor.text);
        if (title.isEmpty) continue;

        chapters.add({
          'id': id,
          'title': title,
          'chapterNo': _chapterNumber(title),
          if (multiLine) ...{
            'lineId': groupId,
            'lineName': groupName,
            'groupId': groupId,
            'groupName': groupName,
          },
        });
      }
    }
    return chapters;
  }

  Future<List<Map<String, dynamic>>> getVideoUrl(String chapterId) async {
    final pageUrl = _pageUrlFromId(chapterId, kind: '播放');
    if (_mediaExtension.hasMatch(pageUrl)) {
      return [
        {
          'quality': '默认',
          'url': pageUrl,
          'type': 'file',
          'headers': {'Referer': '$origin/', 'User-Agent': userAgent},
        },
      ];
    }
    return [
      {
        'quality': '默认',
        'url': pageUrl,
        'type': 'page',
        'headers': {'Referer': pageUrl, 'User-Agent': userAgent},
      },
    ];
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _searchCache.clear();
    if (_ownsDio) _dio.close(force: true);
  }

  Future<String> _fetchHtml(String url, {String? referer}) async {
    _ensureActive();
    final Response<List<int>> response;
    try {
      response = await _dio.get<List<int>>(
        url,
        options: Options(
          responseType: ResponseType.bytes,
          validateStatus: (_) => true,
          followRedirects: true,
          headers: {
            'Referer': referer ?? '$origin/',
            'User-Agent': userAgent,
          },
        ),
      );
    } on DioException catch (error) {
      final type = error.type;
      if (type == DioExceptionType.connectionTimeout ||
          type == DioExceptionType.receiveTimeout ||
          type == DioExceptionType.sendTimeout) {
        throw SevenSeFunException('七色番请求超时：$url');
      }
      if (type == DioExceptionType.connectionError) {
        throw SevenSeFunException('七色番网络不可达：$url');
      }
      throw SevenSeFunException('七色番请求失败：$url（${error.message ?? type}）');
    }

    final status = response.statusCode ?? 0;
    if (status == 401 || status == 403) {
      throw SevenSeFunException('七色番拒绝访问（HTTP $status）：$url');
    }
    if (status < 200 || status >= 400) {
      throw SevenSeFunException('七色番请求失败（HTTP $status）：$url');
    }
    final bytes = response.data;
    if (bytes == null || bytes.isEmpty) {
      throw SevenSeFunException('七色番返回内容为空：$url');
    }
    return utf8.decode(bytes, allowMalformed: true);
  }

  Document _parseDocument(String html, String url) {
    try {
      return html_parser.parse(html);
    } catch (error) {
      throw SevenSeFunException('七色番页面解析失败：$url（$error）');
    }
  }

  String _pageUrlFromId(String rawId, {required String kind}) {
    final raw = rawId.trim();
    if (raw.isEmpty) {
      throw SevenSeFunException('七色番$kind地址为空');
    }
    String decoded;
    try {
      decoded = Uri.decodeComponent(raw);
    } on ArgumentError {
      decoded = raw;
    }
    if (!decoded.startsWith('http') && !decoded.startsWith('/')) {
      throw SevenSeFunException('七色番$kind地址格式无效：$rawId');
    }
    final url = _absolutize(decoded);
    final uri = Uri.tryParse(url);
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) {
      throw SevenSeFunException('七色番$kind地址协议不允许：$url');
    }
    if (!_allowedHosts.contains(uri.host)) {
      throw SevenSeFunException('七色番$kind地址不在本站：$url');
    }
    return url;
  }

  String? _extractStatus(Document document) {
    for (final header in document.querySelectorAll('.chat-stream .chat-header')) {
      final text = _clean(_ownText(header));
      if (text.contains('更新至') || text.contains('全')) {
        return text;
      }
    }
    return null;
  }

  static int? _chapterNumber(String title) {
    final match = RegExp(r'\d+').firstMatch(title);
    if (match == null) return null;
    final value = int.tryParse(match.group(0)!);
    if (value == null || value <= 0) return null;
    return value;
  }

  static String _stringArg(List<dynamic> args, int index, String name) {
    if (args.length <= index || args[index] == null) {
      throw SevenSeFunException('七色番来源缺少参数「$name」');
    }
    final value = args[index].toString().trim();
    if (value.isEmpty) {
      throw SevenSeFunException('七色番来源参数「$name」为空');
    }
    return value;
  }

  static String _absolutize(String raw) {
    final value = raw.trim();
    if (value.isEmpty) return '';
    if (value.startsWith('//')) return 'https:$value';
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('/')) return '$origin$value';
    return '$origin/$value';
  }

  static String _ownText(Element element) {
    final buffer = StringBuffer();
    for (final node in element.nodes) {
      if (node is Text) buffer.write(node.text);
    }
    return buffer.toString();
  }

  static String _clean(String raw) =>
      raw.replaceAll(RegExp(r'\s+'), ' ').trim();

  void _ensureActive() {
    if (_disposed) {
      throw SevenSeFunException('七色番来源已释放');
    }
  }
}

class _ChapterGroup {
  _ChapterGroup({required this.name, required this.anchors});

  final String name;
  final List<Element> anchors;
}

class SevenSeFunException implements Exception {
  const SevenSeFunException(this.message);

  final String message;

  @override
  String toString() => message;
}
