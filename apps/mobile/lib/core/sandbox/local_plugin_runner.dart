import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../sources/kazumi/kazumi_rule.dart';
import '../sources/kazumi/kazumi_source.dart';
import '../sources/seven_se_fun_source.dart';
import '../sync/webdav_config_store.dart';
import '../sources/venera/venera_models.dart';
import '../sources/venera/venera_source.dart';
import '../sources/venera/venera_store.dart';
import 'js_engine.dart';

class LocalPluginRunner {
  final Map<String, JsEngine> _engines = {};

  final Map<String, SevenSeFunSource> _nativeSources = {};

  final Map<String, KazumiSource> _kazumiSources = {};

  final Map<String, VeneraSource> _veneraSources = {};

  void registerVeneraSource(
    InstalledVeneraSource meta,
    String code,
    VeneraStore store, {
    SecureKeyValue? secrets,
  }) {
    _veneraSources.remove(meta.id)?.dispose();
    _veneraSources[meta.id] = VeneraSource(meta, code, store: store, secrets: secrets);
  }

  void unregisterVeneraSource(String pluginId) {
    _veneraSources.remove(pluginId)?.dispose();
  }

  bool hasVeneraSource(String pluginId) => _veneraSources.containsKey(pluginId);

  VeneraSource? veneraSource(String pluginId) => _veneraSources[pluginId];

  Map<String, String>? imageHeadersFor(String pluginId, String url) {
    if (pluginId == 'mangadex') {
      return const {'User-Agent': 'Titanhub/1.1.0 (Android)'};
    }
    return _veneraSources[pluginId]?.imageHeaders(url);
  }

  void registerKazumiRule(KazumiRule rule) {
    if (rule.pluginId == SevenSeFunSource.pluginId) return;
    _kazumiSources.remove(rule.pluginId)?.dispose();
    _kazumiSources[rule.pluginId] = KazumiSource(rule);
  }

  void unregisterKazumiRule(String pluginId) {
    _kazumiSources.remove(pluginId)?.dispose();
  }

  bool hasKazumiRule(String pluginId) => _kazumiSources.containsKey(pluginId);

  Future<JsEngine> _getEngine(String pluginId) async {
    if (_engines.containsKey(pluginId)) {
      return _engines[pluginId]!;
    }
    
    final engine = JsEngine();
    try {
      // Load plugin code from assets
      final jsCode = await rootBundle.loadString('assets/plugins/$pluginId.js');
      await engine.loadPlugin(jsCode);
      _engines[pluginId] = engine;
      return engine;
    } catch (e) {
      engine.dispose();
      rethrow;
    }
  }

  SevenSeFunSource _getNativeSource(String pluginId) {
    return _nativeSources.putIfAbsent(pluginId, SevenSeFunSource.new);
  }

  Future<List<Map<String, dynamic>>> getPluginsList() async {
    return [
      {
        'id': 'bangumi',
        'name': 'Bangumi 番组计划 (本地)',
        'types': ['anime'],
        'isActive': true,
      },
      {
        'id': 'mangadex',
        'name': 'MangaDex 漫画 (本地)',
        'types': ['manga'],
        'isActive': true,
      },
      {
        'id': SevenSeFunSource.pluginId,
        'name': '${SevenSeFunSource.sourceName} (本地)',
        'types': ['anime'],
        'isActive': true,
      },
      {
        'id': 'mock-dmzj',
        'name': '动漫之家 Mock (本地)',
        'types': ['manga'],
        'isActive': true,
      },
      {
        'id': 'mock-movie',
        'name': '影视 Mock (本地)',
        'types': ['movie'],
        'isActive': true,
      },
    ];
  }

  Future<List<String>> exploreTabsFor(String pluginId) async {
    final venera = _veneraSources[pluginId];
    if (venera != null) {
      final info = await venera.info();
      return info.exploreTitles;
    }
    if (pluginId == 'bangumi') return const ['每日放送'];
    if (pluginId == 'mangadex') return const ['人气推荐'];
    return const [];
  }

  Future<dynamic> call(String pluginId, String method, List<dynamic> args) async {
    if (pluginId == SevenSeFunSource.pluginId) {
      return _getNativeSource(pluginId).call(method, args);
    }
    final kazumi = _kazumiSources[pluginId];
    if (kazumi != null) {
      return kazumi.call(method, args);
    }
    final venera = _veneraSources[pluginId];
    if (venera != null) {
      return venera.call(method, args);
    }
    final engine = await _getEngine(pluginId);
    return await engine.callPluginMethod(method, args);
  }

  void dispose() {
    for (var source in _nativeSources.values) {
      source.dispose();
    }
    _nativeSources.clear();
    for (var source in _kazumiSources.values) {
      source.dispose();
    }
    _kazumiSources.clear();
    for (var source in _veneraSources.values) {
      source.dispose();
    }
    _veneraSources.clear();
    for (var engine in _engines.values) {
      engine.dispose();
    }
    _engines.clear();
  }
}

final localPluginRunnerProvider = Provider<LocalPluginRunner>((ref) {
  final runner = LocalPluginRunner();
  ref.onDispose(() => runner.dispose());
  return runner;
});
