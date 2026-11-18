import '../market/market_infra.dart';

const String veneraEngine = 'venera';
const String veneraContentType = 'manga';
const String veneraIdPrefix = 'venera-';
const String veneraMarketDescription = '漫画来源；部分站点需要账号或来源设置。';
const String veneraMarketLimitation = '实验兼容，尚未逐站验证阅读。';

final RegExp veneraKeyPattern = RegExp(r'^[A-Za-z0-9_]+$');

String veneraPluginId(String key) => '$veneraIdPrefix$key';

class VeneraException extends MarketException {
  const VeneraException(super.message);
}

class VeneraConfigHints {
  const VeneraConfigHints({
    this.hasAccount = false,
    this.hasPasswordLogin = false,
    this.hasWebLogin = false,
    this.hasCookieLogin = false,
    this.hasSettings = false,
  });

  factory VeneraConfigHints.analyze(String source) {
    bool has(String pattern) => RegExp(pattern, multiLine: true).hasMatch(source);
    return VeneraConfigHints(
      hasAccount: has(r'^\s*account\s*=\s*\{'),
      hasPasswordLogin: has(r'^\s*login\s*:|^\s*login\s*\(|\blogin\s*:\s*async'),
      hasWebLogin: has(r'\bloginWithWebview\b'),
      hasCookieLogin: has(r'\bloginWithCookies\b'),
      hasSettings: has(r'^\s*settings\s*=\s*\{'),
    );
  }

  factory VeneraConfigHints.fromJson(Object? json) {
    if (json is! Map) return const VeneraConfigHints();
    return VeneraConfigHints(
      hasAccount: json['hasAccount'] == true,
      hasPasswordLogin: json['hasPasswordLogin'] == true,
      hasWebLogin: json['hasWebLogin'] == true,
      hasCookieLogin: json['hasCookieLogin'] == true,
      hasSettings: json['hasSettings'] == true,
    );
  }

  final bool hasAccount;
  final bool hasPasswordLogin;
  final bool hasWebLogin;
  final bool hasCookieLogin;
  final bool hasSettings;

  bool get needsConfig => hasAccount || hasSettings;

  Map<String, dynamic> toJson() => {
        'hasAccount': hasAccount,
        'hasPasswordLogin': hasPasswordLogin,
        'hasWebLogin': hasWebLogin,
        'hasCookieLogin': hasCookieLogin,
        'hasSettings': hasSettings,
      };
}

class VeneraCatalogEntry {
  const VeneraCatalogEntry({
    required this.id,
    required this.key,
    required this.name,
    required this.version,
    required this.fileName,
    required this.downloadUrl,
    this.description = veneraMarketDescription,
  });

  static VeneraCatalogEntry fromIndexEntry(Object? entry, String downloadBase) {
    if (entry is! Map) throw const VeneraException('来源条目格式错误。');
    String text(Object? value) =>
        value is String || value is num ? '$value'.trim() : '';
    final name = text(entry['name']);
    if (name.isEmpty) throw const VeneraException('来源缺少名称。');
    final fileName = text(entry['fileName']).isNotEmpty ? text(entry['fileName']) : text(entry['filename']);
    final key = text(entry['key']).isNotEmpty ? text(entry['key']) : fileName.replaceFirst(RegExp(r'\.js$'), '');
    if (key.isEmpty || fileName.isEmpty) throw const VeneraException('Venera 来源缺少文件地址。');
    if (!veneraKeyPattern.hasMatch(key)) throw VeneraException('来源 key 不合法：$key');
    if (!RegExp(r'^[A-Za-z0-9_.-]+\.js$').hasMatch(fileName)) {
      throw VeneraException('来源文件名不合法：$fileName');
    }
    final rawVersion = text(entry['version']);
    final description = text(entry['description']);
    return VeneraCatalogEntry(
      id: veneraPluginId(key),
      key: key,
      name: name,
      version: rawVersion.isEmpty ? '1.0.0' : rawVersion,
      fileName: fileName,
      downloadUrl: '$downloadBase$fileName',
      description: description.isEmpty ? veneraMarketDescription : description,
    );
  }

  final String id;
  final String key;
  final String name;
  final String version;
  final String fileName;
  final String downloadUrl;
  final String description;

  String get type => veneraContentType;
  String get engine => veneraEngine;

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'version': version,
        'type': type,
        'sourceType': veneraEngine,
        'engine': engine,
        'downloadUrl': downloadUrl,
        'description': description,
        'runtime': 'javascript',
        'compatibility': 'experimental',
        'installable': true,
        'limitation': veneraMarketLimitation,
      };
}

class InstalledVeneraSource {
  const InstalledVeneraSource({
    required this.id,
    required this.key,
    required this.name,
    required this.version,
    required this.fileName,
    required this.downloadUrl,
    required this.catalogUrl,
    required this.enabled,
    required this.installedAt,
    required this.updatedAt,
    this.origin = 'mirror',
    this.hints = const VeneraConfigHints(),
    this.description = veneraMarketDescription,
    this.userDisabled = false,
  });

  factory InstalledVeneraSource.fromJson(Object? json) {
    if (json is! Map) throw const VeneraException('已安装来源元数据不是 JSON 对象');
    String text(String key) {
      final value = json[key];
      if (value is! String || value.isEmpty) {
        throw VeneraException('已安装来源元数据缺少字段: $key');
      }
      return value;
    }

    return InstalledVeneraSource(
      id: text('id'),
      key: text('key'),
      name: text('name'),
      version: text('version'),
      fileName: text('fileName'),
      downloadUrl: json['downloadUrl'] is String ? json['downloadUrl'] as String : '',
      catalogUrl: json['catalogUrl'] is String ? json['catalogUrl'] as String : '',
      enabled: json['enabled'] != false,
      installedAt: DateTime.tryParse('${json['installedAt']}') ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      updatedAt: DateTime.tryParse('${json['updatedAt']}') ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      origin: json['origin'] is String ? json['origin'] as String : 'mirror',
      hints: VeneraConfigHints.fromJson(json['hints']),
      description: json['description'] is String ? json['description'] as String : veneraMarketDescription,
      userDisabled: json['userDisabled'] == true,
    );
  }

  final String id;
  final String key;
  final String name;
  final String version;
  final String fileName;
  final String downloadUrl;
  final String catalogUrl;
  final bool enabled;
  final DateTime installedAt;
  final DateTime updatedAt;
  final String origin;
  final VeneraConfigHints hints;
  final String description;
  final bool userDisabled;

  String get type => veneraContentType;
  String get sourceType => veneraEngine;
  String get engine => veneraEngine;

  InstalledVeneraSource copyWith({
    String? version,
    String? downloadUrl,
    String? catalogUrl,
    bool? enabled,
    DateTime? updatedAt,
    String? origin,
    VeneraConfigHints? hints,
    bool? userDisabled,
  }) {
    return InstalledVeneraSource(
      id: id,
      key: key,
      name: name,
      version: version ?? this.version,
      fileName: fileName,
      downloadUrl: downloadUrl ?? this.downloadUrl,
      catalogUrl: catalogUrl ?? this.catalogUrl,
      enabled: enabled ?? this.enabled,
      installedAt: installedAt,
      updatedAt: updatedAt ?? this.updatedAt,
      origin: origin ?? this.origin,
      hints: hints ?? this.hints,
      description: description,
      userDisabled: userDisabled ?? this.userDisabled,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'key': key,
        'name': name,
        'version': version,
        'type': type,
        'sourceType': sourceType,
        'engine': engine,
        'fileName': fileName,
        'downloadUrl': downloadUrl,
        'catalogUrl': catalogUrl,
        'enabled': enabled,
        'userDisabled': userDisabled,
        'installedAt': installedAt.toUtc().toIso8601String(),
        'updatedAt': updatedAt.toUtc().toIso8601String(),
        'origin': origin,
        'hints': hints.toJson(),
        'description': description,
      };
}
