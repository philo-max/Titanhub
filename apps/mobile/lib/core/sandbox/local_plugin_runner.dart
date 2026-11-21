import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../sources/kazumi/kazumi_rule.dart';
import '../sources/kazumi/kazumi_source.dart';
import '../sources/novel/legado_book_source.dart';
import '../sources/novel/linovelib_source.dart';
import '../sources/seven_se_fun_source.dart';
import '../sync/webdav_config_store.dart';
import '../sources/venera/venera_models.dart';
import '../sources/venera/venera_source.dart';
import '../sources/venera/venera_store.dart';
import 'js_engine.dart';

class LocalPluginRunner {
  final Map<String, JsEngine> _engines = {};
  final Map<String, Future<JsEngine>> _engineFutures = {};

  final Map<String, SevenSeFunSource> _nativeSources = {};

  final Map<String, KazumiSource> _kazumiSources = {};

  final Map<String, VeneraSource> _veneraSources = {};

  final Map<String, LegadoRuleRunner> _legadoSources = {};

  LinovelibSource? _linovelibSource;

  void registerLegadoSource(String id, LegadoBookSource source) {
    _legadoSources[id] = LegadoRuleRunner(source: source);
  }

  void unregisterLegadoSource(String id) {
    _legadoSources.remove(id);
  }

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
    final existing = _engines[pluginId];
    if (existing != null) return existing;
    final inflight = _engineFutures[pluginId];
    if (inflight != null) return inflight;

    final future = () async {
      final engine = JsEngine();
      try {
        final jsCode = await rootBundle.loadString('assets/plugins/$pluginId.js');
        await engine.loadPlugin(jsCode);
        _engines[pluginId] = engine;
        return engine;
      } catch (e) {
        engine.dispose();
        rethrow;
      } finally {
        _engineFutures.remove(pluginId);
      }
    }();
    _engineFutures[pluginId] = future;
    return future;
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
    if (pluginId == LinovelibSource.pluginId) {
      _linovelibSource ??= LinovelibSource();
      return _linovelibSource!.call(method, args);
    }
    final kazumi = _kazumiSources[pluginId];
    if (kazumi != null) {
      return kazumi.call(method, args);
    }
    final venera = _veneraSources[pluginId];
    if (venera != null) {
      return venera.call(method, args);
    }
    final legado = _legadoSources[pluginId];
    if (legado != null) {
      switch (method) {
        case 'search':
          return legado.search('${args.first}');
        case 'getDetail':
          return legado.getDetail('${args.first}');
        case 'getChapters':
          return legado.getChapters('${args.first}');
        case 'getContent':
          return legado.getContent('${args.first}');
      }
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
    _linovelibSource?.dispose();
    _linovelibSource = null;
  }
}

final localPluginRunnerProvider = Provider<LocalPluginRunner>((ref) {
  final runner = LocalPluginRunner();
  ref.onDispose(() => runner.dispose());
  return runner;
});
