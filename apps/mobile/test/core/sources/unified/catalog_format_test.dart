import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/unified/catalog_format.dart';
import 'package:titanhub/core/sources/unified/source_kind.dart';

Object? asset(String path) => jsonDecode(File(path).readAsStringSync());

void main() {
  test('内置规则目录识别为动漫规则格式', () {
    final format = detectCatalogFormat(asset('assets/kazumi/index.json'));
    expect(format, CatalogFormat.rules);
    expect(format.kind, SourceKind.anime);
  });

  test('内置脚本目录识别为漫画脚本格式', () {
    final format = detectCatalogFormat(asset('assets/venera/index.json'));
    expect(format, CatalogFormat.scripts);
    expect(format.kind, SourceKind.manga);
  });

  test('无法识别的格式明确归为 unknown', () {
    expect(detectCatalogFormat(null), CatalogFormat.unknown);
    expect(detectCatalogFormat({'a': 1}), CatalogFormat.unknown);
    expect(detectCatalogFormat(const []), CatalogFormat.unknown);
    expect(detectCatalogFormat(['x']), CatalogFormat.unknown);
    expect(detectCatalogFormat([{'version': '1'}]), CatalogFormat.unknown);
    expect(detectCatalogFormat([{'name': 'a', 'key': 'a'}]), CatalogFormat.unknown);
    expect(detectCatalogFormat([{'name': 'a', 'fileName': 'a.txt', 'key': 'a'}]), CatalogFormat.unknown);
    expect(CatalogFormat.unknown.kind, isNull);
  });

  test('两种格式混杂视为 unknown', () {
    expect(
      detectCatalogFormat([
        {'name': 'a', 'version': '1'},
        {'name': 'b', 'key': 'b', 'fileName': 'b.js', 'version': '1'},
      ]),
      CatalogFormat.unknown,
    );
  });

  test('兼容 filename 写法', () {
    expect(
      detectCatalogFormat([
        {'name': 'b', 'key': 'b', 'filename': 'b.js'}
      ]),
      CatalogFormat.scripts,
    );
  });
}
