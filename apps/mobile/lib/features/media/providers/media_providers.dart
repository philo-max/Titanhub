import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_client.dart';
import '../models/media_models.dart';
import '../../../core/storage/app_database.dart';
import '../../tracking/sync_provider.dart';

// 1. Fetch available plugins
final pluginsListProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get('/api/plugins');
  final List<dynamic> pluginsJson = response.data['plugins'] ?? [];
  return List<Map<String, dynamic>>.from(pluginsJson);
});

// 2. Fetch parallel search results across all plugins
final searchMediaProvider = FutureProvider.family<List<MediaItem>, String>((ref, query) async {
  if (query.trim().isEmpty) return [];

  final dio = ref.watch(apiClientProvider);
  
  // First, get the list of active plugins
  final plugins = await ref.watch(pluginsListProvider.future);
  if (plugins.isEmpty) return [];

  final List<Future<List<MediaItem>>> searchFutures = plugins.map((p) async {
    final pluginId = p['id'] as String;
    final pluginName = p['name'] as String;
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
      // Return empty list if a single plugin fails, allowing other plugins to succeed
      return <MediaItem>[];
    }
  }).toList();

  final List<List<MediaItem>> allResults = await Future.wait(searchFutures);
  return allResults.flat();
});

// 3. Fetch detailed metadata
final mediaDetailProvider = FutureProvider.family<MediaDetail, ({String pluginId, String mediaId})>((ref, arg) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get('/api/plugins/${arg.pluginId}/detail/${arg.mediaId}');
  return MediaDetail.fromJson(response.data['detail']);
});

// 4. Fetch chapters
final mediaChaptersProvider = FutureProvider.family<List<Chapter>, ({String pluginId, String mediaId})>((ref, arg) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get('/api/plugins/${arg.pluginId}/chapters/${arg.mediaId}');
  final List<dynamic> chaptersJson = response.data['chapters'] ?? [];
  return chaptersJson.map((c) => Chapter.fromJson(c)).toList();
});

// 5. Fetch video streaming quality sources
final mediaVideoSourcesProvider = FutureProvider.family<List<VideoSource>, ({String pluginId, String chapterId})>((ref, arg) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get('/api/plugins/${arg.pluginId}/video/${arg.chapterId}');
  final List<dynamic> videosJson = response.data['videos'] ?? [];
  return videosJson.map((v) => VideoSource.fromJson(v)).toList();
});

// 6. Fetch danmakus list
final mediaDanmakusProvider = FutureProvider.family<List<DanmakuComment>, ({String pluginId, String mediaId, String chapterId})>((ref, arg) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get('/api/danmaku/${arg.pluginId}/${arg.mediaId}/${arg.chapterId}');
  final List<dynamic> commentsJson = response.data['comments'] ?? [];
  return commentsJson.map((c) => DanmakuComment.fromJson(c)).toList();
});

// 7. Fetch manga page images list
final mangaPagesProvider = FutureProvider.family<List<String>, ({String pluginId, String chapterId})>((ref, arg) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get('/api/plugins/${arg.pluginId}/images/${arg.chapterId}');
  final List<dynamic> imagesJson = response.data['images'] ?? [];
  return List<String>.from(imagesJson);
});

// 8. Fetch novel text content
final novelContentProvider = FutureProvider.family<String, ({String pluginId, String chapterId})>((ref, arg) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get('/api/plugins/${arg.pluginId}/content/${arg.chapterId}');
  return response.data['content'] ?? '';
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

