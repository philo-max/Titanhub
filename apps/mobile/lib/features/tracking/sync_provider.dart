import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/app_database.dart';

// Global Drift Database Provider
final databaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase();
  ref.onDispose(() => db.close());
  return db;
});

// Authentication Token State Provider (stores the logged-in User ID)
final authTokenProvider = StateProvider<String?>((ref) => null);

// Synchronization Service Provider
final syncServiceProvider = Provider<SyncService>((ref) {
  final db = ref.watch(databaseProvider);
  final dio = ref.watch(apiClientProvider);
  final token = ref.watch(authTokenProvider);
  return SyncService(db, dio, token);
});

class SyncService {
  final AppDatabase _db;
  final Dio _dio;
  final String? _authToken;

  SyncService(this._db, this._dio, this._authToken);

  // Register a new user account
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

  // Log in and store the authentication token
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

  // Push local progress tracking to Hono server (Last-Write-Wins)
  Future<void> pushTracking() async {
    if (_authToken == null) return;

    try {
      final localLogs = await _db.getAllTracking();
      if (localLogs.isEmpty) return;

      final payload = localLogs.map((log) => {
        'mediaId': log.mediaId,
        'pluginId': log.pluginId,
        'mediaType': log.mediaType,
        'chapterNo': log.chapterNo,
        'chapterId': log.chapterId,
        'progress': log.progress,
        'status': log.status,
        'updatedAt': log.updatedAt.toIso8601String(),
      }).toList();

      final response = await _dio.post(
        '/api/sync/tracking',
        data: {'tracking': payload},
        options: Options(headers: {
          'Authorization': 'Bearer $_authToken',
        }),
      );

      if (response.data['success'] == true) {
        final List<dynamic> remoteList = response.data['tracking'] ?? [];
        await _mergeTrackingIntoLocal(remoteList);
      }
    } catch (_) {}
  }

  // Pull remote progress tracking from server and merge locally
  Future<void> pullTracking() async {
    if (_authToken == null) return;

    try {
      final response = await _dio.get(
        '/api/sync/tracking',
        options: Options(headers: {
          'Authorization': 'Bearer $_authToken',
        }),
      );

      if (response.data['success'] == true) {
        final List<dynamic> remoteList = response.data['tracking'] ?? [];
        await _mergeTrackingIntoLocal(remoteList);
      }
    } catch (_) {}
  }

  // Helper method to merge list of tracking logs into local SQLite
  Future<void> _mergeTrackingIntoLocal(List<dynamic> remoteList) async {
    for (var item in remoteList) {
      final map = Map<String, dynamic>.from(item);
      final mediaId = map['mediaId'] as String;
      
      final local = await _db.getTracking(mediaId);
      final remoteTime = DateTime.parse(map['updatedAt'] as String);

      if (local == null || remoteTime.isAfter(local.updatedAt)) {
        await _db.saveTracking(LocalTrackingCompanion(
          id: Value(map['id'] as String),
          mediaId: Value(mediaId),
          pluginId: Value(map['pluginId'] as String),
          mediaType: Value(map['mediaType'] as String),
          chapterNo: Value(map['chapterNo'] as int),
          chapterId: Value(map['chapterId'] as String?),
          progress: Value((map['progress'] as num).toDouble()),
          status: Value(map['status'] as String),
          updatedAt: Value(remoteTime),
        ));
      }
    }
  }

  // Save progress locally and optionally push online
  Future<void> saveProgress({
    required String mediaId,
    required String pluginId,
    required String mediaType,
    required int chapterNo,
    String? chapterId,
    required double progress,
    required String status,
  }) async {
    final now = DateTime.now();
    
    // Check if we already have a record to preserve the primary key UUID
    final existing = await _db.getTracking(mediaId);
    final String trackingId = existing?.id ?? now.millisecondsSinceEpoch.toString();

    await _db.saveTracking(LocalTrackingCompanion(
      id: Value(trackingId),
      mediaId: Value(mediaId),
      pluginId: Value(pluginId),
      mediaType: Value(mediaType),
      chapterNo: Value(chapterNo),
      chapterId: Value(chapterId),
      progress: Value(progress),
      status: Value(status),
      updatedAt: Value(now),
    ));

    // Async push if signed in
    if (_authToken != null) {
      pushTracking();
    }
  }
}
