import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'kazumi_models.dart';
import 'kazumi_rule.dart';

class KazumiStoredRule {
  const KazumiStoredRule({required this.meta, required this.rule});

  final InstalledKazumiSource meta;
  final KazumiRule rule;
}

class KazumiStoreLoadResult {
  const KazumiStoreLoadResult({required this.rules, required this.errors});

  final List<KazumiStoredRule> rules;
  final Map<String, String> errors;
}

class KazumiStoreState {
  const KazumiStoreState({this.seeded = false, this.catalogUrl = ''});

  final bool seeded;
  final String catalogUrl;

  Map<String, dynamic> toJson() => {'seeded': seeded, 'catalogUrl': catalogUrl};
}

class KazumiRuleStore {
  KazumiRuleStore(this.root);

  final Directory root;

  static final RegExp _safeId = RegExp(r'^kazumi-[a-z0-9一-龥-]+$');

  Directory get _rulesDir => Directory(p.join(root.path, 'rules'));
  File get _stateFile => File(p.join(root.path, 'state.json'));

  File _ruleFile(String id) => File(p.join(_rulesDir.path, '$id.json'));
  File _metaFile(String id) => File(p.join(_rulesDir.path, '$id.meta.json'));

  void _requireSafeId(String id) {
    if (!_safeId.hasMatch(id)) {
      throw KazumiRuleException('来源 ID 不合法：$id');
    }
  }

  Future<void> _writeAtomic(File file, String content) async {
    await file.parent.create(recursive: true);
    final temp = File('${file.path}.tmp');
    await temp.writeAsString(content, flush: true);
    await temp.rename(file.path);
  }

  Future<KazumiStoreState> readState() async {
    if (!await _stateFile.exists()) return const KazumiStoreState();
    try {
      final json = jsonDecode(await _stateFile.readAsString());
      if (json is! Map) return const KazumiStoreState();
      return KazumiStoreState(
        seeded: json['seeded'] == true,
        catalogUrl: json['catalogUrl'] is String ? json['catalogUrl'] as String : '',
      );
    } on FormatException {
      return const KazumiStoreState();
    }
  }

  Future<void> writeState(KazumiStoreState state) =>
      _writeAtomic(_stateFile, jsonEncode(state.toJson()));

  Future<KazumiStoreLoadResult> loadAll() async {
    final rules = <KazumiStoredRule>[];
    final errors = <String, String>{};
    if (!await _rulesDir.exists()) {
      return const KazumiStoreLoadResult(rules: [], errors: {});
    }
    final metaFiles = await _rulesDir
        .list()
        .where((e) => e is File && e.path.endsWith('.meta.json'))
        .cast<File>()
        .toList();
    metaFiles.sort((a, b) => a.path.compareTo(b.path));
    for (final metaFile in metaFiles) {
      final id = p.basename(metaFile.path).replaceFirst(RegExp(r'\.meta\.json$'), '');
      try {
        final meta = InstalledKazumiSource.fromJson(jsonDecode(await metaFile.readAsString()));
        final ruleFile = _ruleFile(meta.id);
        if (!await ruleFile.exists()) {
          throw const KazumiRuleException('规则文件缺失');
        }
        final rule = KazumiRule.fromJson(jsonDecode(await ruleFile.readAsString()));
        if (rule.pluginId != meta.id) {
          throw KazumiRuleException('规则身份与元数据不一致：${rule.pluginId} != ${meta.id}');
        }
        rules.add(KazumiStoredRule(meta: meta, rule: rule));
      } catch (error) {
        errors[id] = '$error';
      }
    }
    return KazumiStoreLoadResult(rules: rules, errors: errors);
  }

  Future<void> save(InstalledKazumiSource meta, String rawRuleJson) async {
    _requireSafeId(meta.id);
    await _writeAtomic(_ruleFile(meta.id), rawRuleJson);
    await _writeAtomic(_metaFile(meta.id), jsonEncode(meta.toJson()));
  }

  Future<void> saveMeta(InstalledKazumiSource meta) async {
    _requireSafeId(meta.id);
    await _writeAtomic(_metaFile(meta.id), jsonEncode(meta.toJson()));
  }

  Future<void> remove(String id) async {
    _requireSafeId(id);
    for (final file in [_ruleFile(id), _metaFile(id)]) {
      if (await file.exists()) await file.delete();
    }
  }
}
