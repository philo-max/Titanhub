import 'package:dio/dio.dart';
import 'package:drift/drift.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/identity/media_identity.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/app_database.dart';

final databaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(() => db.close());
  return db;
});

final authTokenProvider = StateProvider<String?>((ref) => null);

final syncServiceProvider = Provider<SyncService>((ref) {
  final db = ref.watch(databaseProvider);
  final dio = ref.watch(apiClientProvider);
  final token = ref.watch(authTokenProvider);
  return SyncService(db, dio, token);
});

final favoriteStatusProvider = StreamProvider.family<bool, MediaIdentity>((ref, identity) {
  final db = ref.watch(databaseProvider);
  return db.watchFavorite(identity).map((row) => row != null);
});

final trackingProvider = StreamProvider.family<LocalTrackingData?, MediaIdentity>((ref, identity) {
  final db = ref.watch(databaseProvider);
  return db.watchTracking(identity);
});

class SyncService {
  SyncService(this._db, this._dio, this._authToken);

  final AppDatabase _db;
  final Dio _dio;
  final String? _authToken;

  Future<bool> register(String username, String password) async {
    try {
      final response = await _dio.post('/api/auth/register', data: {
        'username': username,
        'password': password,
      });
      if (response.data['success'] == true) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  Future<bool> login(WidgetRef ref, String username, String password) async {
    try {
      final response = await _dio.post('/api/auth/login', data: {
        'username': username,
        'password': password,
      });
      if (response.data['success'] == true) {
        final token = response.data['token'] as String;
        ref.read(authTokenProvider.notifier).state = token;
        return true;
      }
    } catch (_) {}
    return false;
  }

  Future<void> pushTracking() async {
    final token = _authToken;
    if (token == null) return;

    try {
      final localLogs = await _db.getAllTracking();
      if (localLogs.isEmpty) return;

      final payload = localLogs
          .map((log) => {
                'id': log.id,
                'mediaId': log.mediaId,
                'pluginId': log.pluginId,
                'mediaType': log.mediaType,
                'chapterNo': log.chapterNo,
                'chapterId': log.chapterId,
                'chapterTitle': log.chapterTitle,
                'progress': log.progress,
                'position': log.position,
                'status': log.status,
                'updatedAt': log.updatedAt.toIso8601String(),
              })
          .toList();

      final response = await _dio.post(
        '/api/sync/tracking',
        data: {'tracking': payload},
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );

      if (response.data['success'] == true) {
        final List<dynamic> remoteList = response.data['tracking'] ?? [];
        await _mergeTrackingIntoLocal(remoteList);
      }
    } catch (_) {}
  }

  Future<void> pullTracking() async {
    final token = _authToken;
    if (token == null) return;

    try {
      final response = await _dio.get(
        '/api/sync/tracking',
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );

      if (response.data['success'] == true) {
        final List<dynamic> remoteList = response.data['tracking'] ?? [];
        await _mergeTrackingIntoLocal(remoteList);
      }
    } catch (_) {}
  }

  Future<void> _mergeTrackingIntoLocal(List<dynamic> remoteList) async {
    for (final item in remoteList) {
      if (item is! Map) continue;
      final map = Map<String, dynamic>.from(item);
      final identity = MediaIdentity(
        pluginId: (map['pluginId'] ?? '').toString(),
        mediaType: (map['mediaType'] ?? '').toString(),
        mediaId: (map['mediaId'] ?? '').toString(),
      );
      if (identity.mediaId.isEmpty) continue;

      final remoteTime = DateTime.tryParse('${map['updatedAt']}');
      if (remoteTime == null) continue;

      final local = await _db.getTracking(identity);
      if (local != null && !remoteTime.isAfter(local.updatedAt)) continue;

      await _db.saveTracking(LocalTrackingCompanion(
        id: Value((map['id'] ?? identity.key).toString()),
        pluginId: Value(identity.pluginId),
        mediaType: Value(identity.mediaType),
        mediaId: Value(identity.mediaId),
        chapterNo: Value((map['chapterNo'] as num?)?.toInt() ?? 0),
        chapterId: Value(map['chapterId'] as String?),
        chapterTitle: Value(map['chapterTitle'] as String?),
        progress: Value((map['progress'] as num?)?.toDouble() ?? 0.0),
        position: Value((map['position'] as num?)?.toInt()),
        status: Value((map['status'] ?? 'watching').toString()),
        updatedAt: Value(remoteTime),
      ));
    }
  }

  Future<void> saveProgress({
    required String pluginId,
    required String mediaType,
    required String mediaId,
    int chapterNo = 0,
    String? chapterId,
    String? chapterTitle,
    required double progress,
    int? position,
    String status = 'watching',
  }) async {
    final identity = MediaIdentity(
      pluginId: pluginId,
      mediaType: mediaType,
      mediaId: mediaId,
    );
    final existing = await _db.getTracking(identity);

    await _db.saveTracking(LocalTrackingCompanion(
      id: Value(existing?.id ?? identity.key),
      pluginId: Value(pluginId),
      mediaType: Value(mediaType),
      mediaId: Value(mediaId),
      chapterNo: Value(chapterNo),
      chapterId: Value(chapterId),
      chapterTitle: Value(chapterTitle),
      progress: Value(progress.clamp(0.0, 1.0)),
      position: Value(position),
      status: Value(status),
      updatedAt: Value(DateTime.now()),
    ));

    if (_authToken != null) {
      pushTracking();
    }
  }

  Future<LocalTrackingData?> loadProgress(MediaIdentity identity) {
    return _db.getTracking(identity);
  }

  Future<bool> isFavorite(MediaIdentity identity) async {
    return (await _db.getFavorite(identity)) != null;
  }

  Future<void> setFavorite(MediaIdentity identity, bool favorite) async {
    if (favorite) {
      await _db.saveFavorite(LocalFavoritesCompanion(
        id: Value(identity.key),
        pluginId: Value(identity.pluginId),
        mediaType: Value(identity.mediaType),
        mediaId: Value(identity.mediaId),
      ));
    } else {
      await _db.deleteFavorite(identity);
    }
  }
}
