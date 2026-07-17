import 'dart:convert';
import 'package:flutter_js/flutter_js.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../models/media_models.dart';
import '../../../core/storage/app_database.dart';
import '../../tracking/sync_provider.dart';
import '../../../core/sandbox/local_plugin_runner.dart';
import 'package:drift/drift.dart';

// 1. Fetch available plugins
final pluginsListProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  try {
    final dio = ref.watch(apiClientProvider);
    final response = await dio.get('/api/plugins');
    final List<dynamic> pluginsJson = response.data['plugins'] ?? [];
    return List<Map<String, dynamic>>.from(pluginsJson);
  } catch (e) {
    print('[Plugins List] Fallback to local runner: $e');
    final runner = ref.watch(localPluginRunnerProvider);
    return await runner.getPluginsList();
  }
});

// 2. Fetch parallel search results across all plugins
final searchMediaProvider = FutureProvider.family<List<MediaItem>, String>((ref, query) async {
  if (query.trim().isEmpty) return [];

  // First, get the list of active plugins
  final plugins = await ref.watch(pluginsListProvider.future);
  if (plugins.isEmpty) return [];

  final List<Future<List<MediaItem>>> searchFutures = plugins.map((p) async {
    final pluginId = p['id'] as String;
    final pluginName = p['name'] as String;
    
    final isLocal = pluginName.endsWith('(本地)') || !p.containsKey('isActive');
    
    if (isLocal) {
      try {
        final runner = ref.watch(localPluginRunnerProvider);
        final List<dynamic> resultsJson = await runner.call(pluginId, 'search', [query]);
        return resultsJson.map((item) {
          final map = Map<String, dynamic>.from(item);
          map['pluginId'] = pluginId;
          map['pluginName'] = pluginName;
          return MediaItem.fromJson(map);
        }).toList();
      } catch (e) {
        print('[Local Search Error] Plugin $pluginId failed: $e');
        return <MediaItem>[];
      }
    } else {
      final dio = ref.watch(apiClientProvider);
      try {
        final response = await dio.get(
          '/api/plugins/$pluginId/search',
          queryParameters: {'q': query},
        );
        final List<dynamic> resultsJson = response.data['results'] ?? [];
        return resultsJson.map((item) {
          final map = Map<String, dynamic>.from(item);
          map['pluginId'] = pluginId;
          map['pluginName'] = pluginName;
          return MediaItem.fromJson(map);
        }).toList();
      } catch (e) {
        return <MediaItem>[];
      }
    }
  }).toList();

  final List<List<MediaItem>> allResults = await Future.wait(searchFutures);
  return allResults.flat();
});

// 3. Fetch detailed metadata
final mediaDetailProvider = FutureProvider.family<MediaDetail, ({String pluginId, String mediaId})>((ref, arg) async {
  final plugins = await ref.watch(pluginsListProvider.future);
  final isLocal = plugins.any((p) => p['id'] == arg.pluginId && (p['name'] as String).endsWith('(本地)'));
  
  if (isLocal) {
    final runner = ref.watch(localPluginRunnerProvider);
    final data = await runner.call(arg.pluginId, 'getDetail', [arg.mediaId]);
    return MediaDetail.fromJson(Map<String, dynamic>.from(data));
  }
  
  try {
    final dio = ref.watch(apiClientProvider);
    final response = await dio.get('/api/plugins/${arg.pluginId}/detail/${arg.mediaId}');
    return MediaDetail.fromJson(response.data['detail']);
  } catch (e) {
    final runner = ref.watch(localPluginRunnerProvider);
    final data = await runner.call(arg.pluginId, 'getDetail', [arg.mediaId]);
    return MediaDetail.fromJson(Map<String, dynamic>.from(data));
  }
});

// 4. Fetch chapters
final mediaChaptersProvider = FutureProvider.family<List<Chapter>, ({String pluginId, String mediaId})>((ref, arg) async {
  final plugins = await ref.watch(pluginsListProvider.future);
  final isLocal = plugins.any((p) => p['id'] == arg.pluginId && (p['name'] as String).endsWith('(本地)'));
  
  if (isLocal) {
    final runner = ref.watch(localPluginRunnerProvider);
    final List<dynamic> chaptersJson = await runner.call(arg.pluginId, 'getChapters', [arg.mediaId]);
    return chaptersJson.map((c) => Chapter.fromJson(Map<String, dynamic>.from(c))).toList();
  }
  
  try {
    final dio = ref.watch(apiClientProvider);
    final response = await dio.get('/api/plugins/${arg.pluginId}/chapters/${arg.mediaId}');
    final List<dynamic> chaptersJson = response.data['chapters'] ?? [];
    return chaptersJson.map((c) => Chapter.fromJson(c)).toList();
  } catch (e) {
    final runner = ref.watch(localPluginRunnerProvider);
    final List<dynamic> chaptersJson = await runner.call(arg.pluginId, 'getChapters', [arg.mediaId]);
    return chaptersJson.map((c) => Chapter.fromJson(Map<String, dynamic>.from(c))).toList();
  }
});

// 5. Fetch video streaming quality sources
final mediaVideoSourcesProvider = FutureProvider.family<List<VideoSource>, ({String pluginId, String chapterId})>((ref, arg) async {
  final plugins = await ref.watch(pluginsListProvider.future);
  final isLocal = plugins.any((p) => p['id'] == arg.pluginId && (p['name'] as String).endsWith('(本地)'));
  
  if (isLocal) {
    final runner = ref.watch(localPluginRunnerProvider);
    final List<dynamic> videosJson = await runner.call(arg.pluginId, 'getVideoUrl', [arg.chapterId]);
    return videosJson.map((v) => VideoSource.fromJson(Map<String, dynamic>.from(v))).toList();
  }
  
  try {
    final dio = ref.watch(apiClientProvider);
    final response = await dio.get('/api/plugins/${arg.pluginId}/video/${arg.chapterId}');
    final List<dynamic> videosJson = response.data['videos'] ?? [];
    return videosJson.map((v) => VideoSource.fromJson(v)).toList();
  } catch (e) {
    final runner = ref.watch(localPluginRunnerProvider);
    final List<dynamic> videosJson = await runner.call(arg.pluginId, 'getVideoUrl', [arg.chapterId]);
    return videosJson.map((v) => VideoSource.fromJson(Map<String, dynamic>.from(v))).toList();
  }
});

// 6. Fetch danmakus list
final mediaDanmakusProvider = FutureProvider.family<List<DanmakuComment>, ({String pluginId, String mediaId, String chapterId})>((ref, arg) async {
  try {
    final dio = ref.watch(apiClientProvider);
    final response = await dio.get('/api/danmaku/${arg.pluginId}/${arg.mediaId}/${arg.chapterId}');
    final List<dynamic> commentsJson = response.data['comments'] ?? [];
    return commentsJson.map((c) => DanmakuComment.fromJson(c)).toList();
  } catch (e) {
    return [];
  }
});

// 7. Fetch manga page images list
final mangaPagesProvider = FutureProvider.family<List<String>, ({String pluginId, String chapterId})>((ref, arg) async {
  final plugins = await ref.watch(pluginsListProvider.future);
  final isLocal = plugins.any((p) => p['id'] == arg.pluginId && (p['name'] as String).endsWith('(本地)'));
  
  if (isLocal) {
    final runner = ref.watch(localPluginRunnerProvider);
    final List<dynamic> imagesJson = await runner.call(arg.pluginId, 'getImages', [arg.chapterId]);
    return List<String>.from(imagesJson);
  }
  
  try {
    final dio = ref.watch(apiClientProvider);
    final response = await dio.get('/api/plugins/${arg.pluginId}/images/${arg.chapterId}');
    final List<dynamic> imagesJson = response.data['images'] ?? [];
    return List<String>.from(imagesJson);
  } catch (e) {
    final runner = ref.watch(localPluginRunnerProvider);
    final List<dynamic> imagesJson = await runner.call(arg.pluginId, 'getImages', [arg.chapterId]);
    return List<String>.from(imagesJson);
  }
});

// 8. Fetch novel text content
final novelContentProvider = FutureProvider.family<String, ({String pluginId, String chapterId})>((ref, arg) async {
  final plugins = await ref.watch(pluginsListProvider.future);
  final isLocal = plugins.any((p) => p['id'] == arg.pluginId && (p['name'] as String).endsWith('(本地)'));
  
  if (isLocal) {
    final runner = ref.watch(localPluginRunnerProvider);
    final content = await runner.call(arg.pluginId, 'getContent', [arg.chapterId]);
    return content?.toString() ?? '';
  }
  
  try {
    final dio = ref.watch(apiClientProvider);
    final response = await dio.get('/api/plugins/${arg.pluginId}/content/${arg.chapterId}');
    return response.data['content'] ?? '';
  } catch (e) {
    final runner = ref.watch(localPluginRunnerProvider);
    final content = await runner.call(arg.pluginId, 'getContent', [arg.chapterId]);
    return content?.toString() ?? '';
  }
});

// Helper extension to flatten list of lists in Dart
extension FlatMap<T> on Iterable<Iterable<T>> {
  List<T> flat() => [for (var subList in this) ...subList];
}

final isFavoriteProvider = StreamProvider.family<bool, String>((ref, mediaId) {
  final db = ref.watch(databaseProvider);
  return (db.select(db.localFavorites)..where((tbl) => tbl.mediaId.equals(mediaId))).watch().map((list) => list.isNotEmpty);
});

final lastTrackingProvider = StreamProvider.family<LocalTrackingData?, String>((ref, mediaId) {
  final db = ref.watch(databaseProvider);
  return (db.select(db.localTracking)..where((tbl) => tbl.mediaId.equals(mediaId))).watchSingleOrNull();
});
