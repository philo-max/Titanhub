import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'js_engine.dart';

class LocalPluginRunner {
  final Map<String, JsEngine> _engines = {};

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

  Future<dynamic> call(String pluginId, String method, List<dynamic> args) async {
    final engine = await _getEngine(pluginId);
    return await engine.callPluginMethod(method, args);
  }

  void dispose() {
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
