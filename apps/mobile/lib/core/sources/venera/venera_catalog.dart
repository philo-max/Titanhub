import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;

import 'venera_models.dart';

const String veneraRepoPath = 'venera-app/venera-configs';

const List<String> defaultVeneraCatalogBases = [
  'https://raw.githubusercontent.com/$veneraRepoPath/main/',
  'https://cdn.jsdelivr.net/gh/$veneraRepoPath@main/',
  'https://fastly.jsdelivr.net/gh/$veneraRepoPath@main/',
  'https://gcore.jsdelivr.net/gh/$veneraRepoPath@main/',
  'https://testingcf.jsdelivr.net/gh/$veneraRepoPath@main/',
  'https://gh-proxy.com/https://raw.githubusercontent.com/$veneraRepoPath/main/',
  'https://ghfast.top/https://raw.githubusercontent.com/$veneraRepoPath/main/',
];

const int veneraMaxIndexBytes = 2 * 1024 * 1024;
const int veneraMaxSourceBytes = 2 * 1024 * 1024;
const String veneraSnapshotIndexAsset = 'assets/venera/index.json';
const String veneraSnapshotSourceDir = 'assets/venera/sources/';
const String veneraSnapshotOrigin = 'snapshot';

final RegExp veneraClassPattern = RegExp(r'class\s+(\w+)\s+extends\s+ComicSource');
final RegExp veneraKeyDeclaration = RegExp(r'''\bkey\s*=\s*["']([^"']+)["']''');

String validateVeneraSource(String source, {String? expectedKey}) {
  final match = veneraClassPattern.firstMatch(source);
  if (match == null) throw const VeneraException('不是有效的 Venera 来源：缺少 class … extends ComicSource');
  final declared = veneraKeyDeclaration.firstMatch(source)?.group(1);
  if (declared == null) throw const VeneraException('来源缺少 key 声明');
  if (!veneraKeyPattern.hasMatch(declared)) throw VeneraException('来源 key 不合法：$declared');
  if (expectedKey != null && declared != expectedKey) {
    throw VeneraException('来源 key $declared 与目录 $expectedKey 不一致');
  }
  return declared;
}

List<VeneraCatalogEntry> parseVeneraIndex(Object? json, String downloadBase, {List<String>? warnings}) {
  if (json is! List) throw const VeneraException('目录不是数组');
  final entries = <VeneraCatalogEntry>[];
  final seen = <String>{};
  for (final item in json) {
    try {
      final entry = VeneraCatalogEntry.fromIndexEntry(item, downloadBase);
      if (seen.add(entry.id)) entries.add(entry);
    } on VeneraException catch (error) {
      warnings?.add('忽略无效目录条目：$error');
    }
  }
  return entries;
}

typedef VeneraAssetLoader = Future<String> Function(String key);

class VeneraSnapshot {
  VeneraSnapshot({VeneraAssetLoader? loader}) : _loader = loader ?? rootBundle.loadString;

  final VeneraAssetLoader _loader;
  Object? _index;

  Future<List<VeneraCatalogEntry>> entries() async {
    _index ??= jsonDecode(await _loader(veneraSnapshotIndexAsset));
    return parseVeneraIndex(_index, veneraSnapshotSourceDir);
  }

  Future<String?> sourceText(String fileName) async {
    try {
      return await _loader('$veneraSnapshotSourceDir$fileName');
    } catch (_) {
      return null;
    }
  }
}
