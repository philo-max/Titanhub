import 'source_kind.dart';

enum CatalogFormat {
  rules(SourceKind.anime),
  scripts(SourceKind.manga),
  unknown(null);

  const CatalogFormat(this.kind);

  final SourceKind? kind;
}

CatalogFormat detectCatalogFormat(Object? json) {
  if (json is! List || json.isEmpty) return CatalogFormat.unknown;
  var scripts = 0;
  var rules = 0;
  for (final entry in json) {
    if (entry is! Map) return CatalogFormat.unknown;
    final name = entry['name'];
    if (name is! String || name.trim().isEmpty) return CatalogFormat.unknown;
    final fileName = entry['fileName'] ?? entry['filename'];
    if (fileName is String && fileName.endsWith('.js') && entry['key'] is String) {
      scripts++;
    } else if (fileName == null && entry['key'] == null) {
      rules++;
    } else {
      return CatalogFormat.unknown;
    }
  }
  if (scripts > 0 && rules == 0) return CatalogFormat.scripts;
  if (rules > 0 && scripts == 0) return CatalogFormat.rules;
  return CatalogFormat.unknown;
}
