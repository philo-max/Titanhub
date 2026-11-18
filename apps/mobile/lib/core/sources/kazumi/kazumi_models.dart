import 'kazumi_rule.dart';

class KazumiCatalogEntry {
  const KazumiCatalogEntry({
    required this.id,
    required this.name,
    required this.version,
    required this.type,
    required this.downloadUrl,
    this.sourceType = 'kazumi',
    this.description = kazumiMarketDescription,
    this.runtime = 'javascript',
    this.compatibility = 'compatible',
    this.installable = true,
    this.limitation,
  });

  static KazumiCatalogEntry fromIndexEntry(Object? entry, String downloadBase) {
    if (entry is! Map) {
      throw const KazumiRuleException('来源条目格式错误。');
    }
    final name = entry['name'] is String || entry['name'] is num ? '${entry['name']}'.trim() : '';
    if (name.isEmpty) throw const KazumiRuleException('来源缺少名称。');
    final rawVersion = entry['version'];
    final version = rawVersion is String || rawVersion is num ? '$rawVersion'.trim() : '';
    return KazumiCatalogEntry(
      id: KazumiRule.pluginIdForName(name),
      name: name,
      version: version.isEmpty ? '1.0.0' : version,
      type: entry['type'] == 'movie' ? 'movie' : 'anime',
      downloadUrl: '$downloadBase${Uri.encodeComponent(name)}.json',
    );
  }

  final String id;
  final String name;
  final String version;
  final String type;
  final String sourceType;
  final String downloadUrl;
  final String description;
  final String runtime;
  final String compatibility;
  final bool installable;
  final String? limitation;

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'version': version,
        'type': type,
        'sourceType': sourceType,
        'downloadUrl': downloadUrl,
        'description': description,
        'runtime': runtime,
        'compatibility': compatibility,
        'installable': installable,
        if (limitation != null) 'limitation': limitation,
      };
}

const String kazumiMarketDescription = '支持 XPath 与 JSON API 规则；播放可用性以实际站点为准。';

class InstalledKazumiSource {
  const InstalledKazumiSource({
    required this.id,
    required this.name,
    required this.version,
    required this.type,
    required this.downloadUrl,
    required this.catalogUrl,
    required this.enabled,
    required this.installedAt,
    required this.updatedAt,
    this.origin = 'mirror',
    this.sourceType = 'kazumi',
    this.userDisabled = false,
  });

  factory InstalledKazumiSource.fromJson(Object? json) {
    if (json is! Map) throw const KazumiRuleException('已安装来源元数据不是 JSON 对象');
    String text(String key) {
      final value = json[key];
      if (value is! String || value.isEmpty) {
        throw KazumiRuleException('已安装来源元数据缺少字段: $key');
      }
      return value;
    }

    return InstalledKazumiSource(
      id: text('id'),
      name: text('name'),
      version: text('version'),
      type: json['type'] == 'movie' ? 'movie' : 'anime',
      downloadUrl: json['downloadUrl'] is String ? json['downloadUrl'] as String : '',
      catalogUrl: json['catalogUrl'] is String ? json['catalogUrl'] as String : '',
      enabled: json['enabled'] != false,
      installedAt: DateTime.tryParse('${json['installedAt']}') ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      updatedAt: DateTime.tryParse('${json['updatedAt']}') ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
      origin: json['origin'] is String ? json['origin'] as String : 'mirror',
      sourceType: 'kazumi',
      userDisabled: json['userDisabled'] == true,
    );
  }

  final String id;
  final String name;
  final String version;
  final String type;
  final String sourceType;
  final String downloadUrl;
  final String catalogUrl;
  final bool enabled;
  final DateTime installedAt;
  final DateTime updatedAt;
  final String origin;
  final bool userDisabled;

  String get engine => 'kazumi';

  InstalledKazumiSource copyWith({
    String? version,
    String? downloadUrl,
    String? catalogUrl,
    bool? enabled,
    DateTime? updatedAt,
    String? origin,
    bool? userDisabled,
  }) {
    return InstalledKazumiSource(
      id: id,
      name: name,
      version: version ?? this.version,
      type: type,
      downloadUrl: downloadUrl ?? this.downloadUrl,
      catalogUrl: catalogUrl ?? this.catalogUrl,
      enabled: enabled ?? this.enabled,
      installedAt: installedAt,
      updatedAt: updatedAt ?? this.updatedAt,
      origin: origin ?? this.origin,
      userDisabled: userDisabled ?? this.userDisabled,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'version': version,
        'type': type,
        'sourceType': sourceType,
        'engine': engine,
        'downloadUrl': downloadUrl,
        'catalogUrl': catalogUrl,
        'enabled': enabled,
        'userDisabled': userDisabled,
        'installedAt': installedAt.toUtc().toIso8601String(),
        'updatedAt': updatedAt.toUtc().toIso8601String(),
        'origin': origin,
      };
}

enum KazumiInstallStatus { installed, updated, upToDate, skipped, failed }

class KazumiInstallItem {
  const KazumiInstallItem({
    required this.id,
    required this.name,
    required this.status,
    this.message = '',
    this.version = '',
  });

  final String id;
  final String name;
  final KazumiInstallStatus status;
  final String message;
  final String version;
}

class KazumiInstallReport {
  const KazumiInstallReport({
    required this.items,
    required this.catalogOrigin,
    this.catalogWarnings = const [],
  });

  final List<KazumiInstallItem> items;
  final String catalogOrigin;
  final List<String> catalogWarnings;

  int count(KazumiInstallStatus status) => items.where((i) => i.status == status).length;

  List<KazumiInstallItem> get failures =>
      items.where((i) => i.status == KazumiInstallStatus.failed).toList();

  String get summary =>
      '新装 ${count(KazumiInstallStatus.installed)} · 更新 ${count(KazumiInstallStatus.updated)} · '
      '已最新 ${count(KazumiInstallStatus.upToDate)} · 跳过 ${count(KazumiInstallStatus.skipped)} · '
      '失败 ${count(KazumiInstallStatus.failed)}';
}
