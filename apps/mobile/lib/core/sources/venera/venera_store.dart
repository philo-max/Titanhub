import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import '../market/market_infra.dart';
import 'venera_models.dart';

class VeneraStoredSource {
  const VeneraStoredSource({required this.meta, required this.code});

  final InstalledVeneraSource meta;
  final String code;
}

class VeneraStoreLoadResult {
  const VeneraStoreLoadResult({required this.sources, required this.errors});

  final List<VeneraStoredSource> sources;
  final Map<String, String> errors;
}

class VeneraStoreState {
  const VeneraStoreState({this.seeded = false, this.catalogUrl = '', this.showAdult = false});

  final bool seeded;
  final String catalogUrl;
  final bool showAdult;

  Map<String, dynamic> toJson() => {'seeded': seeded, 'catalogUrl': catalogUrl, 'showAdult': showAdult};
}

class VeneraStore {
  VeneraStore(this.root);

  final Directory root;

  static final RegExp _safeId = RegExp(r'^venera-[A-Za-z0-9_]+$');

  Directory get _sourcesDir => Directory(p.join(root.path, 'sources'));
  Directory get _dataDir => Directory(p.join(root.path, 'data'));
  File get _stateFile => File(p.join(root.path, 'state.json'));

  File _codeFile(String id) => File(p.join(_sourcesDir.path, '$id.js'));
  File _metaFile(String id) => File(p.join(_sourcesDir.path, '$id.meta.json'));
  File dataFile(String id) {
    _requireSafeId(id);
    return File(p.join(_dataDir.path, '$id.data.json'));
  }

  File cookieFile(String id) {
    _requireSafeId(id);
    return File(p.join(_dataDir.path, '$id.cookies.json'));
  }

  void _requireSafeId(String id) {
    if (!_safeId.hasMatch(id)) throw VeneraException('来源 ID 不合法：$id');
  }

  Future<VeneraStoreState> readState() async {
    if (!await _stateFile.exists()) return const VeneraStoreState();
    try {
      final json = jsonDecode(await _stateFile.readAsString());
      if (json is! Map) return const VeneraStoreState();
      return VeneraStoreState(
        seeded: json['seeded'] == true,
        catalogUrl: json['catalogUrl'] is String ? json['catalogUrl'] as String : '',
        showAdult: json['showAdult'] == true,
      );
    } on FormatException {
      return const VeneraStoreState();
    }
  }

  Future<void> writeState(VeneraStoreState state) =>
      writeFileAtomic(_stateFile, jsonEncode(state.toJson()));

  Future<VeneraStoreLoadResult> loadAll() async {
    final sources = <VeneraStoredSource>[];
    final errors = <String, String>{};
    if (!await _sourcesDir.exists()) return const VeneraStoreLoadResult(sources: [], errors: {});
    final metaFiles = await _sourcesDir
        .list()
        .where((e) => e is File && e.path.endsWith('.meta.json'))
        .cast<File>()
        .toList();
    metaFiles.sort((a, b) => a.path.compareTo(b.path));
    for (final metaFile in metaFiles) {
      final id = p.basename(metaFile.path).replaceFirst(RegExp(r'\.meta\.json$'), '');
      try {
        final meta = InstalledVeneraSource.fromJson(jsonDecode(await metaFile.readAsString()));
        _requireSafeId(meta.id);
        final codeFile = _codeFile(meta.id);
        if (!await codeFile.exists()) throw const VeneraException('来源脚本缺失');
        sources.add(VeneraStoredSource(meta: meta, code: await codeFile.readAsString()));
      } catch (error) {
        errors[id] = '$error';
      }
    }
    return VeneraStoreLoadResult(sources: sources, errors: errors);
  }

  Future<void> save(InstalledVeneraSource meta, String code) async {
    _requireSafeId(meta.id);
    await writeFileAtomic(_codeFile(meta.id), code);
    await writeFileAtomic(_metaFile(meta.id), jsonEncode(meta.toJson()));
  }

  Future<void> saveMeta(InstalledVeneraSource meta) async {
    _requireSafeId(meta.id);
    await writeFileAtomic(_metaFile(meta.id), jsonEncode(meta.toJson()));
  }

  Future<void> remove(String id) async {
    _requireSafeId(id);
    for (final file in [_codeFile(id), _metaFile(id), dataFile(id), cookieFile(id)]) {
      if (await file.exists()) await file.delete();
    }
  }

  Future<Map<String, dynamic>> readJsonMap(File file) async {
    if (!await file.exists()) return {};
    try {
      final json = jsonDecode(await file.readAsString());
      return json is Map ? Map<String, dynamic>.from(json) : {};
    } on FormatException {
      return {};
    }
  }

  Future<void> writeJsonMap(File file, Map<String, dynamic> value) =>
      writeFileAtomic(file, jsonEncode(value));
}
