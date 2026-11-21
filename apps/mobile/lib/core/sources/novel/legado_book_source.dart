import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html_parser;

import '../media_source.dart';

class LegadoSearchRule {
  const LegadoSearchRule({
    required this.bookList,
    required this.name,
    required this.bookUrl,
    this.author = '',
    this.coverUrl = '',
    this.intro = '',
  });

  factory LegadoSearchRule.fromJson(Map<String, dynamic> json) {
    return LegadoSearchRule(
      bookList: '${json['bookList'] ?? ''}',
      name: '${json['name'] ?? ''}',
      bookUrl: '${json['bookUrl'] ?? ''}',
      author: '${json['author'] ?? ''}',
      coverUrl: '${json['coverUrl'] ?? ''}',
      intro: '${json['intro'] ?? ''}',
    );
  }

  Map<String, dynamic> toJson() => {
        'bookList': bookList,
        'name': name,
        'bookUrl': bookUrl,
        'author': author,
        'coverUrl': coverUrl,
        'intro': intro,
      };

  final String bookList;
  final String name;
  final String bookUrl;
  final String author;
  final String coverUrl;
  final String intro;
}

class LegadoTocRule {
  const LegadoTocRule({
    required this.chapterList,
    required this.chapterName,
    required this.chapterUrl,
  });

  factory LegadoTocRule.fromJson(Map<String, dynamic> json) {
    return LegadoTocRule(
      chapterList: '${json['chapterList'] ?? ''}',
      chapterName: '${json['chapterName'] ?? ''}',
      chapterUrl: '${json['chapterUrl'] ?? ''}',
    );
  }

  Map<String, dynamic> toJson() => {
        'chapterList': chapterList,
        'chapterName': chapterName,
        'chapterUrl': chapterUrl,
      };

  final String chapterList;
  final String chapterName;
  final String chapterUrl;
}

/// Subset of the open-source Legado (阅读) JSON book source specification.
class LegadoBookSource {
  const LegadoBookSource({
    required this.name,
    required this.baseUrl,
    required this.searchUrl,
    required this.ruleSearch,
    required this.ruleToc,
    required this.contentRule,
    this.tocUrlRule = '',
    this.introRule = '',
    this.coverRule = '',
    this.headers = const {},
  });

  factory LegadoBookSource.fromJson(Map<String, dynamic> json) {
    final rawHeaders = json['header'];
    final headers = <String, String>{};
    if (rawHeaders is String && rawHeaders.trim().startsWith('{')) {
      final decoded = jsonDecode(rawHeaders);
      if (decoded is Map) {
        for (final e in decoded.entries) {
          headers['${e.key}'] = '${e.value}';
        }
      }
    } else if (rawHeaders is Map) {
      for (final e in rawHeaders.entries) {
        headers['${e.key}'] = '${e.value}';
      }
    }
    final bookInfo = (json['ruleBookInfo'] as Map?)?.cast<String, dynamic>() ?? const {};
    final contentMap = (json['ruleContent'] as Map?)?.cast<String, dynamic>() ?? const {};
    return LegadoBookSource(
      name: '${json['bookSourceName'] ?? '未命名书源'}',
      baseUrl: '${json['bookSourceUrl'] ?? ''}'.trim(),
      searchUrl: '${json['searchUrl'] ?? ''}'.trim(),
      ruleSearch: LegadoSearchRule.fromJson(
        (json['ruleSearch'] as Map?)?.cast<String, dynamic>() ?? const {},
      ),
      ruleToc: LegadoTocRule.fromJson(
        (json['ruleToc'] as Map?)?.cast<String, dynamic>() ?? const {},
      ),
      contentRule: '${contentMap['content'] ?? ''}',
      tocUrlRule: '${bookInfo['tocUrl'] ?? ''}',
      introRule: '${bookInfo['intro'] ?? ''}',
      coverRule: '${bookInfo['coverUrl'] ?? ''}',
      headers: headers,
    );
  }

  final String name;
  final String baseUrl;
  final String searchUrl;
  final LegadoSearchRule ruleSearch;
  final LegadoTocRule ruleToc;
  final String contentRule;
  final String tocUrlRule;
  final String introRule;
  final String coverRule;
  final Map<String, String> headers;

  /// Deterministic FNV-1a ID across app restarts so bookmarks and deduplication
  /// never collide or drift when Dart's per-process `hashCode` changes.
  String get stableId {
    final key = '${baseUrl.trim().toLowerCase()}|${name.trim().toLowerCase()}';
    var hash = 0x811c9dc5;
    for (final unit in utf8.encode(key)) {
      hash ^= unit;
      hash = (hash * 0x01000193) & 0xffffffff;
    }
    return 'legado-${hash.toRadixString(16).padLeft(8, '0')}';
  }

  MediaSource toMediaSource() => MediaSource(
        id: stableId,
        name: name,
        types: const ['novel'],
        capabilities: const {
          MediaCapability.search,
          MediaCapability.detail,
          MediaCapability.chapters,
          MediaCapability.content,
        },
      );

  Map<String, dynamic> toJson() => {
        'bookSourceName': name,
        'bookSourceUrl': baseUrl,
        'searchUrl': searchUrl,
        'header': headers,
        'ruleSearch': ruleSearch.toJson(),
        'ruleBookInfo': {
          'tocUrl': tocUrlRule,
          'intro': introRule,
          'coverUrl': coverRule,
        },
        'ruleToc': ruleToc.toJson(),
        'ruleContent': {
          'content': contentRule,
        },
      };

  static List<LegadoBookSource> parseList(String rawJson) {
    final decoded = jsonDecode(rawJson);
    if (decoded is List) {
      return [
        for (final item in decoded)
          if (item is Map) LegadoBookSource.fromJson(Map<String, dynamic>.from(item)),
      ];
    }
    if (decoded is Map) {
      return [LegadoBookSource.fromJson(Map<String, dynamic>.from(decoded))];
    }
    return const [];
  }
}

/// Evaluates Legado CSS/text/attr/regex rules against HTML documents.
class LegadoRuleRunner {
  LegadoRuleRunner({required this.source, Dio? dio}) : _dio = dio ?? Dio();

  final LegadoBookSource source;
  final Dio _dio;

  String _resolveUrl(String maybeRelative, {String? baseUrl}) {
    final trimmed = maybeRelative.trim();
    if (trimmed.isEmpty) return '';
    final parsed = Uri.tryParse(trimmed);
    if (parsed != null && parsed.hasScheme) return trimmed;
    final candidateBase = (baseUrl != null && baseUrl.trim().isNotEmpty)
        ? baseUrl.trim()
        : source.baseUrl;
    final base = Uri.tryParse(candidateBase);
    if (base == null) return trimmed;
    return base.resolve(trimmed).toString();
  }

  Future<({String url, String body})> _fetchWithUrl(String url, {String? baseUrl}) async {
    final full = _resolveUrl(url, baseUrl: baseUrl);
    final res = await _dio.get<String>(
      full,
      options: Options(
        headers: {
          'User-Agent':
              'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
          ...source.headers,
        },
        responseType: ResponseType.plain,
      ),
    );
    final finalUrl = res.realUri.toString().isNotEmpty ? res.realUri.toString() : full;
    return (url: finalUrl, body: res.data ?? '');
  }

  static List<dom.Element> selectElements(dom.Element root, String rawRule) {
    final cleaned = rawRule.replaceFirst(RegExp(r'^@css:'), '').trim();
    if (cleaned.isEmpty) return const [];
    return root.querySelectorAll(cleaned);
  }

  static String extractValue(dom.Element root, String rawRule) {
    var rule = rawRule.trim();
    if (rule.isEmpty) return '';

    String? regexPattern;
    String regexReplace = '';
    final hashIdx = rule.indexOf('##');
    if (hashIdx >= 0) {
      final regexParts = rule.substring(hashIdx + 2).split('##');
      regexPattern = regexParts.first;
      regexReplace = regexParts.length > 1 ? regexParts[1] : '';
      rule = rule.substring(0, hashIdx).trim();
    }

    rule = rule.replaceFirst(RegExp(r'^@css:'), '').trim();
    final atParts = rule.split('@');
    final attrOrMode = atParts.length > 1 ? atParts.last.trim() : 'text';
    final selector = atParts.length > 1
        ? atParts.sublist(0, atParts.length - 1).join('@').trim()
        : rule;

    final target = selector.isEmpty ? root : root.querySelector(selector);
    if (target == null) return '';

    String out;
    if (attrOrMode == 'text' || attrOrMode == 'textNodes') {
      out = target.text.trim();
    } else if (attrOrMode == 'html') {
      out = target.innerHtml.trim();
    } else {
      out = (target.attributes[attrOrMode] ?? '').trim();
    }

    if (regexPattern != null && regexPattern.isNotEmpty) {
      out = out.replaceAll(RegExp(regexPattern), regexReplace);
    }
    return out.trim();
  }

  Future<List<Map<String, dynamic>>> search(String keyword) async {
    final url = source.searchUrl
        .replaceAll('{{key}}', Uri.encodeComponent(keyword))
        .replaceAll('{{page}}', '1');
    final fetched = await _fetchWithUrl(url);
    final doc = html_parser.parse(fetched.body);
    final root = doc.documentElement;
    if (root == null) return const [];
    final items = selectElements(root, source.ruleSearch.bookList);
    return [
      for (final el in items)
        {
          'id': _resolveUrl(extractValue(el, source.ruleSearch.bookUrl), baseUrl: fetched.url),
          'title': extractValue(el, source.ruleSearch.name),
          'cover': _resolveUrl(extractValue(el, source.ruleSearch.coverUrl), baseUrl: fetched.url),
          'description': extractValue(el, source.ruleSearch.intro),
        },
    ].where((m) => '${m['id']}'.isNotEmpty && '${m['title']}'.isNotEmpty).toList();
  }

  Future<Map<String, dynamic>> getDetail(String bookUrl) async {
    final resolvedBookUrl = _resolveUrl(bookUrl);
    try {
      final fetched = await _fetchWithUrl(resolvedBookUrl);
      final doc = html_parser.parse(fetched.body);
      final root = doc.documentElement;
      final title = root?.querySelector('meta[property="og:title"]')?.attributes['content']?.trim() ??
          root?.querySelector('h1')?.text.trim() ??
          root?.querySelector('title')?.text.trim() ??
          resolvedBookUrl;
      final cover = (root != null && source.coverRule.trim().isNotEmpty)
          ? _resolveUrl(extractValue(root, source.coverRule), baseUrl: fetched.url)
          : _resolveUrl(
              root?.querySelector('meta[property="og:image"]')?.attributes['content'] ?? '',
              baseUrl: fetched.url,
            );
      final intro = (root != null && source.introRule.trim().isNotEmpty)
          ? extractValue(root, source.introRule)
          : (root?.querySelector('meta[property="og:description"]')?.attributes['content']?.trim() ??
              '来自 Legado 书源：${source.name}');
      return {
        'id': resolvedBookUrl,
        'title': title.isNotEmpty ? title : resolvedBookUrl,
        'cover': cover,
        'description': intro.isNotEmpty ? intro : '来自 Legado 书源：${source.name}',
      };
    } catch (_) {
      return {
        'id': resolvedBookUrl,
        'title': resolvedBookUrl,
        'cover': '',
        'description': '来自 Legado 书源：${source.name}',
      };
    }
  }

  Future<List<Map<String, dynamic>>> getChapters(String bookUrl) async {
    var fetched = await _fetchWithUrl(bookUrl);
    var doc = html_parser.parse(fetched.body);
    var root = doc.documentElement;
    if (root != null && source.tocUrlRule.trim().isNotEmpty) {
      final tocUrl = extractValue(root, source.tocUrlRule);
      if (tocUrl.isNotEmpty) {
        fetched = await _fetchWithUrl(tocUrl, baseUrl: fetched.url);
        doc = html_parser.parse(fetched.body);
        root = doc.documentElement;
      }
    }
    if (root == null) return const [];
    final list = selectElements(root, source.ruleToc.chapterList);
    final chapters = <Map<String, dynamic>>[];
    for (var i = 0; i < list.length; i++) {
      final el = list[i];
      final chUrl = _resolveUrl(
        extractValue(el, source.ruleToc.chapterUrl),
        baseUrl: fetched.url,
      );
      final chTitle = extractValue(el, source.ruleToc.chapterName);
      if (chUrl.isEmpty) continue;
      chapters.add({
        'id': chUrl,
        'title': chTitle.isEmpty ? '第 ${i + 1} 章' : chTitle,
        'chapterNo': chapters.length + 1,
      });
    }
    return chapters;
  }

  Future<String> getContent(String chapterUrl) async {
    final fetched = await _fetchWithUrl(chapterUrl);
    final doc = html_parser.parse(fetched.body);
    final root = doc.documentElement;
    if (root == null) return '';
    final raw = extractValue(root, source.contentRule);
    return raw
        .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
        .replaceAll(RegExp(r'</p>', caseSensitive: false), '\n\n')
        .replaceAll(RegExp(r'<[^>]+>'), '')
        .replaceAll('&nbsp;', ' ')
        .replaceAll(RegExp(r'\n{3,}'), '\n\n')
        .trim();
  }
}
