import '../market/market_infra.dart';
import 'source_kind.dart';

enum SourceTag {
  needsConfig('需配置'),
  needsLogin('需登录'),
  adult('成人向'),
  experimental('实验兼容'),
  updatable('可更新');

  const SourceTag(this.label);

  final String label;
}

class UnifiedSource {
  const UnifiedSource({
    required this.id,
    required this.name,
    required this.version,
    required this.kind,
    required this.enabled,
    this.tags = const [],
    this.configurable = false,
  });

  final String id;
  final String name;
  final String version;
  final SourceKind kind;
  final bool enabled;
  final List<SourceTag> tags;
  final bool configurable;

  bool get adult => tags.contains(SourceTag.adult);
}

class UnifiedAvailable {
  const UnifiedAvailable({
    required this.id,
    required this.name,
    required this.version,
    required this.kind,
    this.adult = false,
  });

  final String id;
  final String name;
  final String version;
  final SourceKind kind;
  final bool adult;
}

class UnifiedReportItem {
  const UnifiedReportItem(this.name, this.message);

  final String name;
  final String message;
}

class UnifiedReport {
  const UnifiedReport({
    this.installed = 0,
    this.updated = 0,
    this.upToDate = 0,
    this.skipped = 0,
    this.failures = const [],
    this.notes = const [],
    this.warnings = const [],
    this.origins = const [],
    this.enabled = 0,
  });

  factory UnifiedReport.fromMarket({
    required Iterable<({String name, String status, String message})> items,
    required String origin,
    required List<String> warnings,
  }) {
    var installed = 0, updated = 0, upToDate = 0, skipped = 0;
    final failures = <UnifiedReportItem>[];
    final notes = <UnifiedReportItem>[];
    for (final item in items) {
      switch (item.status) {
        case 'installed':
          installed++;
        case 'updated':
          updated++;
        case 'upToDate':
          upToDate++;
        case 'skipped':
          skipped++;
        default:
          failures.add(UnifiedReportItem(item.name, item.message));
      }
      if (item.status != 'failed' && item.status != 'upToDate' && item.message.isNotEmpty) {
        notes.add(UnifiedReportItem(item.name, item.message));
      }
    }
    return UnifiedReport(
      installed: installed,
      updated: updated,
      upToDate: upToDate,
      skipped: skipped,
      failures: failures,
      notes: notes,
      warnings: warnings,
      origins: [origin],
    );
  }

  UnifiedReport withEnabled(int count) => UnifiedReport(
        installed: installed,
        updated: updated,
        upToDate: upToDate,
        skipped: skipped,
        failures: failures,
        notes: notes,
        warnings: warnings,
        origins: origins,
        enabled: count,
      );

  static UnifiedReport fromMarketReport(MarketInstallReport report) => UnifiedReport.fromMarket(
        items: [
          for (final item in report.items)
            (name: item.name, status: item.status.name, message: item.message),
        ],
        origin: report.catalogOrigin,
        warnings: report.catalogWarnings,
      );

  final int installed;
  final int updated;
  final int upToDate;
  final int skipped;
  final List<UnifiedReportItem> failures;
  final List<UnifiedReportItem> notes;
  final List<String> warnings;
  final List<String> origins;
  final int enabled;

  UnifiedReport merge(UnifiedReport other) => UnifiedReport(
        installed: installed + other.installed,
        updated: updated + other.updated,
        upToDate: upToDate + other.upToDate,
        skipped: skipped + other.skipped,
        failures: [...failures, ...other.failures],
        notes: [...notes, ...other.notes],
        warnings: [...warnings, ...other.warnings],
        origins: [...origins, ...other.origins],
        enabled: enabled + other.enabled,
      );

  String get summary =>
      '新装 $installed · 更新 $updated · 已最新 $upToDate · 启用 $enabled · 跳过 $skipped · 失败 ${failures.length}';
}
