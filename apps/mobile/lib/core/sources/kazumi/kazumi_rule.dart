import '../market/market_infra.dart';

class KazumiRuleException extends MarketException {
  const KazumiRuleException(super.message);
}

class KazumiAntiCrawler {
  const KazumiAntiCrawler({
    this.enabled = false,
    this.detectType = 1,
    this.detectValue = '',
    this.captchaImage = '',
    this.captchaButton = '',
  });

  factory KazumiAntiCrawler.fromJson(Object? json) {
    if (json is! Map) return const KazumiAntiCrawler();
    return KazumiAntiCrawler(
      enabled: json['enabled'] == true,
      detectType: json['captchaDetectType'] is int ? json['captchaDetectType'] as int : 1,
      detectValue: json['captchaDetectValue']?.toString() ?? '',
      captchaImage: json['captchaImage']?.toString() ?? '',
      captchaButton: json['captchaButton']?.toString() ?? '',
    );
  }

  final bool enabled;
  final int detectType;
  final String detectValue;
  final String captchaImage;
  final String captchaButton;
}

class KazumiRule {
  KazumiRule._({
    required this.raw,
    required this.name,
    required this.version,
    required this.type,
    required this.baseUrl,
    required this.userAgent,
    required this.referer,
    required this.searchMode,
    required this.chapterMode,
    required this.searchUrl,
    required this.searchList,
    required this.searchName,
    required this.searchResult,
    required this.chapterRoads,
    required this.chapterResult,
    required this.searchApi,
    required this.chapterApi,
    required this.antiCrawler,
  });

  factory KazumiRule.fromJson(Object? json) {
    if (json is! Map) {
      throw const KazumiRuleException('规则不是 JSON 对象');
    }
    final raw = Map<String, dynamic>.from(json);
    String text(String key) => raw[key] is String ? (raw[key] as String).trim() : '';

    final name = text('name');
    if (name.isEmpty) throw const KazumiRuleException('Kazumi 规则缺少必需字段: name');
    final baseUrl = text('baseUrl').isNotEmpty ? text('baseUrl') : text('baseURL');
    final baseUri = Uri.tryParse(baseUrl);
    if (baseUrl.isEmpty ||
        baseUri == null ||
        !(baseUri.scheme == 'http' || baseUri.scheme == 'https') ||
        baseUri.host.isEmpty) {
      throw KazumiRuleException('Kazumi 规则「$name」缺少有效的 baseUrl/baseURL');
    }

    final searchMode = text('searchMode') == 'api' ? 'api' : 'xpath';
    final chapterMode = text('chapterMode') == 'api' ? 'api' : 'xpath';
    Map<String, dynamic>? searchApi;
    Map<String, dynamic>? chapterApi;
    if (searchMode == 'api') {
      searchApi = _apiConfig(raw['searchApiConfig']);
      final request = searchApi?['request'];
      if (searchApi == null ||
          request is! Map ||
          (request['url']?.toString() ?? '').isEmpty ||
          (searchApi['listPath']?.toString() ?? '').isEmpty ||
          (searchApi['namePath']?.toString() ?? '').isEmpty ||
          (searchApi['sourcePath']?.toString() ?? '').isEmpty) {
        throw KazumiRuleException('Kazumi 规则「$name」缺少必需字段: searchApiConfig');
      }
    } else {
      for (final field in const ['searchURL', 'searchList', 'searchName', 'searchResult']) {
        if (text(field).isEmpty) {
          throw KazumiRuleException('Kazumi 规则「$name」缺少必需字段: $field');
        }
      }
    }
    if (chapterMode == 'api') {
      chapterApi = _apiConfig(raw['chapterApiConfig']);
      final request = chapterApi?['request'];
      final format = chapterApi?['format'];
      if (chapterApi == null ||
          request is! Map ||
          (request['url']?.toString() ?? '').isEmpty ||
          (format != 'nested' && format != 'delimited')) {
        throw KazumiRuleException('Kazumi 规则「$name」缺少必需字段: chapterApiConfig');
      }
    }

    return KazumiRule._(
      raw: raw,
      name: name,
      version: raw['version']?.toString().trim().isNotEmpty == true
          ? raw['version'].toString().trim()
          : '1.0.0',
      type: text('type') == 'movie' ? 'movie' : 'anime',
      baseUrl: baseUrl,
      userAgent: text('userAgent'),
      referer: text('referer'),
      searchMode: searchMode,
      chapterMode: chapterMode,
      searchUrl: text('searchURL'),
      searchList: text('searchList'),
      searchName: text('searchName'),
      searchResult: text('searchResult'),
      chapterRoads: text('chapterRoads'),
      chapterResult: text('chapterResult'),
      searchApi: searchApi,
      chapterApi: chapterApi,
      antiCrawler: KazumiAntiCrawler.fromJson(raw['antiCrawlerConfig']),
    );
  }

  static Map<String, dynamic>? _apiConfig(Object? value) =>
      value is Map ? Map<String, dynamic>.from(value) : null;

  static String slugify(String name) {
    final slug = name
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9一-龥]+'), '-')
        .replaceAll(RegExp(r'^-+|-+$'), '');
    return slug.isEmpty ? 'imported-rule' : slug;
  }

  static String pluginIdForName(String name) => 'kazumi-${slugify(name)}';

  final Map<String, dynamic> raw;
  final String name;
  final String version;
  final String type;
  final String baseUrl;
  final String userAgent;
  final String referer;
  final String searchMode;
  final String chapterMode;
  final String searchUrl;
  final String searchList;
  final String searchName;
  final String searchResult;
  final String chapterRoads;
  final String chapterResult;
  final Map<String, dynamic>? searchApi;
  final Map<String, dynamic>? chapterApi;
  final KazumiAntiCrawler antiCrawler;

  String get pluginId => pluginIdForName(name);

  Map<String, dynamic> toJson() => raw;
}

int compareKazumiVersions(String a, String b) => compareSourceVersions(a, b);
