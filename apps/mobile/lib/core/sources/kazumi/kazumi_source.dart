import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:html/dom.dart';
import 'package:html/parser.dart' as html_parser;
import 'package:xpath_selector_html_parser/xpath_selector_html_parser.dart';

import 'kazumi_api.dart';
import 'kazumi_rule.dart';

class KazumiSourceException implements Exception {
  const KazumiSourceException(this.message);

  final String message;

  @override
  String toString() => message;
}

class _PageCacheEntry {
  _PageCacheEntry(this.future, this.expiresAt);

  final Future<String> future;
  final DateTime expiresAt;
}

class _RetryableFailure implements Exception {
  const _RetryableFailure(this.describe);

  final String Function(int retries, String seconds) describe;
}

class KazumiSource {
  KazumiSource(
    this.rule, {
    Dio? dio,
    DateTime Function()? clock,
    this.retryDelays = defaultRetryDelays,
    this.pageCacheMaxEntries = 30,
  })  : _dio = dio ?? _createDio(),
        _ownsDio = dio == null,
        _clock = clock ?? DateTime.now;

  static const List<Duration> defaultRetryDelays = [Duration(milliseconds: 600), Duration(milliseconds: 1500)];
  static const Duration pageCacheTtl = Duration(minutes: 2);

  static const String defaultUserAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  static const int maxResponseBytes = 8 * 1024 * 1024;

  static final RegExp _mediaExtension =
      RegExp(r'\.(m3u8|mp4|flv|webm)(?:[?#]|$)', caseSensitive: false);

  final KazumiRule rule;
  final Dio _dio;
  final bool _ownsDio;
  final DateTime Function() _clock;
  final List<Duration> retryDelays;
  final int pageCacheMaxEntries;
  final Map<String, _PageCacheEntry> _pageCache = {};
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
      ),
    );
  }

  Map<String, String> get requestHeaders => {
        'User-Agent': rule.userAgent.isNotEmpty ? rule.userAgent : defaultUserAgent,
        'Referer': rule.referer.isNotEmpty ? rule.referer : rule.baseUrl,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      };

  String get _label => rule.name;

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
        throw KazumiSourceException('$_label 来源不支持方法「$method」');
    }
  }

  Future<List<Map<String, dynamic>>> search(String keyword) async {
    final trimmed = keyword.trim();
    if (trimmed.isEmpty) return const <Map<String, dynamic>>[];
    return rule.searchMode == 'api' ? _searchApi(trimmed) : _searchXPath(trimmed);
  }

  Future<List<Map<String, dynamic>>> _searchApi(String keyword) async {
    final config = rule.searchApi!;
    final data = await _requestJson(
      Map<String, dynamic>.from(config['request'] as Map),
      {'keyword': keyword},
    );
    final hits = _guard(() => parseKazumiApiSearch(rule.baseUrl, config, data), '搜索接口解析失败');
    return [
      for (final hit in hits)
        _remember({'id': hit.id, 'title': hit.title, 'cover': hit.cover}),
    ];
  }

  Future<List<Map<String, dynamic>>> _searchXPath(String keyword) async {
    final url = rule.searchUrl.replaceAll(
      RegExp(r'@keyword|\{keyword\}'),
      Uri.encodeComponent(keyword),
    );
    _requireHttp(url, '搜索');
    final html = await _fetchText(url);
    final root = _documentElement(html, url);
    _throwIfChallenged(html, root, url);

    final nodes = _select(root, rule.searchList, '搜索结果列表');
    final results = <Map<String, dynamic>>[];
    final seen = <String>{};
    var unmatched = 0;
    for (final node in nodes) {
      final name = _selectFirst(node, rule.searchName, '条目名称');
      final link = _selectFirst(node, rule.searchResult, '条目链接');
      final href = link?.attributes['href']?.trim() ?? '';
      final title = _clean(name?.text ?? '');
      if (href.isEmpty || title.isEmpty) {
        unmatched += 1;
        continue;
      }
      final id = Uri.encodeComponent(href);
      if (!seen.add(id)) continue;
      results.add(_remember({'id': id, 'title': title, 'cover': _coverFromNode(node)}));
    }
    if (nodes.isNotEmpty && results.isEmpty) {
      throw KazumiSourceException(
        '$_label 搜索页解析失败：匹配到 $unmatched 个结果节点，但名称/链接选择器均未命中（站点结构可能已变化）：$url',
      );
    }
    return results;
  }

  Map<String, dynamic> _remember(Map<String, dynamic> item) {
    if (_searchCache.length >= 200) _searchCache.remove(_searchCache.keys.first);
    _searchCache[item['id'] as String] = {
      'title': item['title'] as String,
      'cover': item['cover'] as String,
    };
    return item;
  }

  Future<Map<String, dynamic>> getDetail(String mediaId) async {
    if (rule.chapterMode == 'api') return _detailApi(mediaId);
    final pageUrl = _pageUrlFromId(mediaId, kind: '详情');
    final html = await _fetchPage(pageUrl);
    final document = _parseDocument(html, pageUrl);

    var cover = '';
    final ogImage = document.querySelector('meta[property="og:image"]')?.attributes['content'];
    if (ogImage != null && ogImage.trim().isNotEmpty) {
      cover = absolutizeKazumiUrl(rule.baseUrl, ogImage.trim());
    }
    if (cover.isEmpty) {
      final img = document.querySelector('.detail-pic img, .pic img, img.lazy');
      final raw = img?.attributes['data-src'] ??
          img?.attributes['data-original'] ??
          img?.attributes['src'] ??
          '';
      cover = absolutizeKazumiUrl(rule.baseUrl, raw.trim());
    }
    final cached = _searchCache[mediaId];
    if (cover.isEmpty && cached != null) cover = cached['cover'] ?? '';

    var title = _clean(document.querySelector('h1')?.text ?? '');
    if (title.isEmpty) title = _clean(document.querySelector('title')?.text ?? '');
    if (title.isEmpty) title = cached?['title'] ?? '';
    if (title.isEmpty) {
      throw KazumiSourceException('$_label 详情页解析失败（缺少标题）：$pageUrl');
    }
    final description = _clean(
      document.querySelector('meta[name="description"]')?.attributes['content'] ??
          document.querySelector('meta[property="og:description"]')?.attributes['content'] ??
          '',
    );
    return {
      'id': mediaId,
      'title': title,
      'cover': cover,
      'description': description,
    };
  }

  Future<Map<String, dynamic>> _detailApi(String mediaId) async {
    final cached = _searchCache[mediaId];
    if (cached != null) {
      return {'id': mediaId, 'title': cached['title'], 'cover': cached['cover']};
    }
    final source = _decodeId(mediaId);
    final data = await _requestJson(
      Map<String, dynamic>.from(rule.chapterApi!['request'] as Map),
      {'source': source},
    );
    Object? body = data;
    if (data is Map) body = data['data'] ?? data['info'] ?? data;
    String field(List<String> keys) {
      if (body is! Map) return '';
      for (final key in keys) {
        final value = body[key];
        if (value != null && '$value'.isNotEmpty) return '$value';
      }
      return '';
    }

    final title = field(['title', 'vod_name', 'name']);
    return {
      'id': mediaId,
      'title': title.isEmpty ? source : title,
      'cover': absolutizeKazumiUrl(rule.baseUrl, field(['cover', 'vod_pic'])),
      'description': field(['description', 'vod_content']),
    };
  }

  Future<List<Map<String, dynamic>>> getChapters(String mediaId) async {
    if (rule.chapterMode == 'api') return _chaptersApi(mediaId);
    if (rule.chapterRoads.isEmpty || rule.chapterResult.isEmpty) {
      throw KazumiSourceException('$_label 规则未配置章节选择器，无法获取剧集');
    }
    final pageUrl = _pageUrlFromId(mediaId, kind: '详情');
    final html = await _fetchPage(pageUrl);
    final root = _documentElement(html, pageUrl);
    try {
      _throwIfChallenged(html, root, pageUrl);
    } catch (_) {
      _pageCache.remove(pageUrl);
      rethrow;
    }

    var roads = _select(root, rule.chapterRoads, '播放线路列表');
    if (roads.isEmpty) roads = [root];
    final multiLine = roads.length > 1;
    final chapters = <Map<String, dynamic>>[];
    for (var roadIndex = 0; roadIndex < roads.length; roadIndex++) {
      final groupId = 'line-${roadIndex + 1}';
      final groupName = '线路${roadIndex + 1}';
      final seenIds = <String>{};
      var position = 0;
      for (final item in _select(roads[roadIndex], rule.chapterResult, '剧集列表')) {
        final href = item.attributes['href']?.trim() ?? '';
        if (href.isEmpty) continue;
        position += 1;
        final id = Uri.encodeComponent(href);
        if (!seenIds.add(id)) continue;
        final title = _clean(item.text ?? '');
        chapters.add({
          'id': id,
          'title': title.isEmpty ? '第 $position 话' : title,
          'chapterNo': position,
          if (multiLine) ...{
            'lineId': groupId,
            'lineName': groupName,
            'groupId': groupId,
            'groupName': groupName,
          },
        });
      }
    }
    if (chapters.isEmpty) {
      throw KazumiSourceException('$_label 详情页未解析到任何剧集（线路 ${roads.length} 条）：$pageUrl');
    }
    return chapters;
  }

  Future<List<Map<String, dynamic>>> _chaptersApi(String mediaId) async {
    final config = rule.chapterApi!;
    final source = _decodeId(mediaId);
    final data = await _requestJson(
      Map<String, dynamic>.from(config['request'] as Map),
      {'source': source},
    );
    final parsed = _guard(
      () => parseKazumiApiChapters(rule.baseUrl, config, data, source),
      '剧集接口解析失败',
    );
    if (parsed.isEmpty) {
      throw KazumiSourceException('$_label 剧集接口未返回任何剧集：$source');
    }
    final roadCount = parsed.map((c) => c.roadIndex).toSet().length;
    final multiLine = roadCount > 1;
    return [
      for (final chapter in parsed)
        {
          'id': chapter.id,
          'title': chapter.title,
          'chapterNo': chapter.chapterNo,
          if (multiLine) ...{
            'lineId': 'line-${chapter.roadIndex + 1}',
            'lineName': chapter.roadName,
            'groupId': 'line-${chapter.roadIndex + 1}',
            'groupName': chapter.roadName,
          },
        },
    ];
  }

  Future<List<Map<String, dynamic>>> getVideoUrl(String chapterId) async {
    final pageUrl = _pageUrlFromId(chapterId, kind: '播放');
    final headers = Map<String, String>.of(requestHeaders);
    if (_mediaExtension.hasMatch(pageUrl)) {
      return [
        {'quality': '默认', 'url': pageUrl, 'type': 'file', 'headers': headers},
      ];
    }
    return [
      {'quality': '默认', 'url': pageUrl, 'type': 'page', 'headers': headers},
    ];
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _searchCache.clear();
    _pageCache.clear();
    if (_ownsDio) _dio.close(force: true);
  }

  Future<String> _fetchPage(String url) {
    final now = _clock();
    _pageCache.removeWhere((_, entry) => !entry.expiresAt.isAfter(now));
    final cached = _pageCache[url];
    if (cached != null) return cached.future;
    final future = _fetchText(url);
    if (_pageCache.length >= pageCacheMaxEntries) _pageCache.remove(_pageCache.keys.first);
    final entry = _PageCacheEntry(future, now.add(pageCacheTtl));
    _pageCache[url] = entry;
    future.then((_) {}, onError: (_) {
      if (identical(_pageCache[url], entry)) _pageCache.remove(url);
    });
    return future;
  }

  Future<String> _fetchText(String url) async {
    final bytes = await _send(url, method: 'GET');
    return utf8.decode(bytes, allowMalformed: true);
  }

  Future<Object?> _requestJson(Map<String, dynamic> config, Map<String, Object?> variables) async {
    final url = _guard(() => kazumiApiUrl(rule.baseUrl, config, variables), '接口地址无效');
    _requireHttp(url, '接口');
    final headers = requestHeaders;
    final extra = kazumiReplaceVariables(config['headers'] ?? const {}, variables, encode: false);
    if (extra is Map) {
      for (final entry in extra.entries) {
        headers[entry.key.toString()] = '${entry.value}';
      }
    }
    final method = (config['method']?.toString() ?? 'GET').toUpperCase();
    Object? body;
    if (config['body'] != null && method != 'GET' && method != 'HEAD') {
      final replaced = kazumiReplaceVariables(config['body'], variables, encode: false);
      final bodyType = config['bodyType']?.toString();
      final hasContentType = headers.keys.any((k) => k.toLowerCase() == 'content-type');
      if (bodyType == 'json') {
        body = jsonEncode(replaced);
        if (!hasContentType) headers['Content-Type'] = 'application/json';
      } else if ((bodyType == 'form' || bodyType == 'form-urlencoded') && replaced is Map) {
        body = replaced.entries
            .map((e) => '${Uri.encodeComponent('${e.key}')}=${Uri.encodeComponent('${e.value}')}')
            .join('&');
        if (!hasContentType) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        body = replaced is String ? replaced : jsonEncode(replaced);
      }
    }
    final bytes = await _send(url, method: method, headers: headers, body: body);
    try {
      return jsonDecode(utf8.decode(bytes, allowMalformed: true));
    } on FormatException {
      throw KazumiSourceException('$_label 接口返回的不是 JSON：$url');
    }
  }

  Future<List<int>> _send(
    String url, {
    required String method,
    Map<String, String>? headers,
    Object? body,
  }) async {
    final watch = Stopwatch()..start();
    for (var attempt = 0;; attempt++) {
      _ensureActive();
      try {
        return await _sendOnce(url, method: method, headers: headers, body: body, watch: watch);
      } on _RetryableFailure catch (failure) {
        if (attempt >= retryDelays.length) {
          throw KazumiSourceException(failure.describe(attempt, _seconds(watch)));
        }
        await Future<void>.delayed(retryDelays[attempt]);
      }
    }
  }

  static String _seconds(Stopwatch watch) => (watch.elapsedMilliseconds / 1000).toStringAsFixed(1);

  String _retryNote(int retries) => retries > 0 ? '，已重试 $retries 次' : '';

  Future<List<int>> _sendOnce(
    String url, {
    required String method,
    required Stopwatch watch,
    Map<String, String>? headers,
    Object? body,
  }) async {
    final Response<List<int>> response;
    try {
      response = await _dio.request<List<int>>(
        url,
        data: body,
        options: Options(
          method: method,
          responseType: ResponseType.bytes,
          validateStatus: (_) => true,
          followRedirects: true,
          headers: headers ?? requestHeaders,
        ),
      );
    } on DioException catch (error) {
      final type = error.type;
      final host = Uri.tryParse(url)?.host ?? url;
      String? phase;
      if (type == DioExceptionType.connectionTimeout) phase = '连接超时';
      if (type == DioExceptionType.sendTimeout) phase = '发送超时';
      if (type == DioExceptionType.receiveTimeout) phase = '接收超时';
      if (phase != null) {
        throw _RetryableFailure((retries, seconds) =>
            '$_label $phase（主机 $host，耗时 $seconds 秒${_retryNote(retries)}）：$url');
      }
      if (type == DioExceptionType.connectionError) {
        throw _RetryableFailure((retries, seconds) =>
            '$_label 网络不可达（主机 $host，耗时 $seconds 秒${_retryNote(retries)}）：$url');
      }
      if (type == DioExceptionType.badCertificate) {
        throw KazumiSourceException('$_label 证书校验失败：$url');
      }
      throw KazumiSourceException('$_label 请求失败：$url（${error.message ?? type}）');
    }
    final status = response.statusCode ?? 0;
    if (status == 401 || status == 403) {
      throw KazumiSourceException('$_label 拒绝访问（HTTP $status，可能需要验证或地区限制）：$url');
    }
    if (status == 429) {
      throw _RetryableFailure((retries, _) => '$_label 请求过于频繁（HTTP 429${_retryNote(retries)}）：$url');
    }
    if (status >= 500) {
      throw _RetryableFailure((retries, _) => '$_label 请求失败（HTTP $status${_retryNote(retries)}）：$url');
    }
    if (status < 200 || status >= 400) {
      throw KazumiSourceException('$_label 请求失败（HTTP $status）：$url');
    }
    final bytes = response.data;
    if (bytes == null || bytes.isEmpty) {
      throw KazumiSourceException('$_label 返回内容为空：$url');
    }
    if (bytes.length > maxResponseBytes) {
      throw KazumiSourceException('$_label 返回内容过大（${bytes.length} 字节）：$url');
    }
    return bytes;
  }

  Document _parseDocument(String html, String url) {
    try {
      return html_parser.parse(html);
    } catch (error) {
      throw KazumiSourceException('$_label 页面解析失败：$url（$error）');
    }
  }

  Element _documentElement(String html, String url) {
    final element = _parseDocument(html, url).documentElement;
    if (element == null) {
      throw KazumiSourceException('$_label 页面没有根节点：$url');
    }
    return element;
  }

  List<Node> _select(Node context, String expression, String label) {
    if (expression.trim().isEmpty) {
      throw KazumiSourceException('$_label 规则的$label XPath 为空');
    }
    try {
      return [for (final item in HtmlXPath.node(context).query(expression).nodes) item.node];
    } catch (error) {
      throw KazumiSourceException('$_label 规则的$label XPath 无效：$expression（$error）');
    }
  }

  Node? _selectFirst(Node context, String expression, String label) {
    final nodes = _select(context, expression, label);
    return nodes.isEmpty ? null : nodes.first;
  }

  static final RegExp _backgroundImage = RegExp(r'url\(\s*["\x27]?([^"\x27)]+)');

  String _coverFromNode(Node node) {
    if (node is! Element) return '';
    final images = node.localName == 'img' ? [node] : node.querySelectorAll('img');
    for (final image in images) {
      for (final key in const ['data-src', 'data-original', 'data-lazy-src', 'src']) {
        final raw = image.attributes[key]?.trim() ?? '';
        if (raw.isNotEmpty && !raw.startsWith('data:')) return absolutizeKazumiUrl(rule.baseUrl, raw);
      }
    }
    final styled = [node, ...node.querySelectorAll('[style*="url("]')];
    for (final element in styled) {
      final match = _backgroundImage.firstMatch(element.attributes['style'] ?? '');
      final raw = match?.group(1)?.trim() ?? '';
      if (raw.isNotEmpty && !raw.startsWith('data:')) return absolutizeKazumiUrl(rule.baseUrl, raw);
    }
    return '';
  }

  void _throwIfChallenged(String raw, Element root, String url) {
    final config = rule.antiCrawler;
    if (!config.enabled) return;
    var challenged = false;
    final value = config.detectValue.trim();
    if (value.isNotEmpty) {
      switch (config.detectType) {
        case 2:
          challenged = raw.contains(value);
        case 3:
          try {
            challenged = RegExp(value, caseSensitive: false, dotAll: true).hasMatch(raw);
          } on FormatException {
            challenged = false;
          }
        default:
          challenged = _select(root, value, '验证页检测').isNotEmpty;
      }
    } else {
      for (final expression in [config.captchaImage, config.captchaButton]) {
        if (expression.trim().isNotEmpty && _select(root, expression, '验证页检测').isNotEmpty) {
          challenged = true;
          break;
        }
      }
    }
    if (challenged) {
      throw KazumiSourceException('$_label 站点要求人机验证，手机端暂不支持自动验证：$url');
    }
  }

  T _guard<T>(T Function() action, String message) {
    try {
      return action();
    } on KazumiRuleException catch (error) {
      throw KazumiSourceException('$_label $message：$error');
    } catch (error) {
      throw KazumiSourceException('$_label $message：$error');
    }
  }

  String _decodeId(String rawId) {
    try {
      return Uri.decodeComponent(rawId);
    } on ArgumentError {
      return rawId;
    }
  }

  void _requireHttp(String url, String kind) {
    final uri = Uri.tryParse(url);
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https') || uri.host.isEmpty) {
      throw KazumiSourceException('$_label $kind地址无效：$url');
    }
  }

  String _pageUrlFromId(String rawId, {required String kind}) {
    final decoded = _decodeId(rawId.trim());
    if (decoded.isEmpty) {
      throw KazumiSourceException('$_label $kind地址为空');
    }
    if (RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*:').hasMatch(decoded) &&
        !RegExp(r'^https?:', caseSensitive: false).hasMatch(decoded)) {
      throw KazumiSourceException('$_label $kind地址协议不允许：$decoded');
    }
    final url = _upgradeSameHostScheme(absolutizeKazumiUrl(rule.baseUrl, decoded));
    _requireHttp(url, kind);
    return url;
  }

  String _upgradeSameHostScheme(String url) {
    final target = Uri.tryParse(url);
    final base = Uri.tryParse(rule.baseUrl);
    if (target == null || base == null) return url;
    if (target.scheme == 'http' && base.scheme == 'https' && target.host == base.host && !target.hasPort) {
      return target.replace(scheme: 'https').toString();
    }
    return url;
  }

  static String _stringArg(List<dynamic> args, int index, String name) {
    if (args.length <= index || args[index] == null) {
      throw KazumiSourceException('Kazumi 来源缺少参数「$name」');
    }
    final value = args[index].toString().trim();
    if (value.isEmpty) {
      throw KazumiSourceException('Kazumi 来源参数「$name」为空');
    }
    return value;
  }

  static String _clean(String raw) => raw.replaceAll(RegExp(r'\s+'), ' ').trim();

  void _ensureActive() {
    if (_disposed) {
      throw KazumiSourceException('$_label 来源已释放');
    }
  }
}
