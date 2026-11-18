import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/identity/media_identity.dart';
import 'package:titanhub/core/storage/app_database.dart';
import 'package:titanhub/features/tracking/sync_provider.dart';

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.calls);

  final List<String> calls;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add('${options.method} ${options.path}');
    final body = options.path.contains('/sync/tracking') && options.method == 'GET'
        ? {'success': true, 'tracking': <dynamic>[]}
        : {'success': true};
    return ResponseBody.fromString(
      jsonEncode(body),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Dio _fakeDio(List<String> calls) {
  final dio = Dio(BaseOptions(baseUrl: 'http://127.0.0.1:1'));
  dio.httpClientAdapter = _FakeAdapter(calls);
  return dio;
}

void main() {
  late AppDatabase db;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
  });

  tearDown(() async {
    await db.close();
  });

  test('未登录保存进度不发起任何同步请求', () async {
    final calls = <String>[];
    final service = SyncService(db, _fakeDio(calls), null);

    await service.saveProgress(
      pluginId: 'bangumi',
      mediaType: 'anime',
      mediaId: 'm-1',
      chapterNo: 4,
      chapterId: 'ep-4',
      chapterTitle: '第4话',
      progress: 0.35,
      position: 420000,
    );
    await Future<void>.delayed(const Duration(milliseconds: 20));

    expect(calls, isEmpty);
    final saved = await service.loadProgress(const MediaIdentity(
      pluginId: 'bangumi',
      mediaType: 'anime',
      mediaId: 'm-1',
    ));
    expect(saved?.chapterNo, 4);
    expect(saved?.chapterTitle, '第4话');
    expect(saved?.position, 420000);
  });

  test('两个来源的同 ID 进度分别保存且各自恢复', () async {
    final service = SyncService(db, _fakeDio([]), null);
    const anime = MediaIdentity(pluginId: 'bangumi', mediaType: 'anime', mediaId: 'x');
    const manga = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: 'x');

    await service.saveProgress(
      pluginId: anime.pluginId,
      mediaType: anime.mediaType,
      mediaId: anime.mediaId,
      chapterNo: 1,
      chapterId: 'ep-1',
      progress: 0.2,
      position: 90000,
    );
    await service.saveProgress(
      pluginId: manga.pluginId,
      mediaType: manga.mediaType,
      mediaId: manga.mediaId,
      chapterNo: 8,
      chapterId: 'ch-8',
      progress: 0.7,
      position: 12,
    );

    expect((await service.loadProgress(anime))?.position, 90000);
    expect((await service.loadProgress(manga))?.position, 12);
    expect(await db.getAllTracking(), hasLength(2));
  });

  test('重复保存同一身份不产生重复行，且只保留最后一次位置', () async {
    final service = SyncService(db, _fakeDio([]), null);
    const identity = MediaIdentity(pluginId: 'bangumi', mediaType: 'anime', mediaId: 'r');

    for (var second = 5; second <= 30; second += 5) {
      await service.saveProgress(
        pluginId: identity.pluginId,
        mediaType: identity.mediaType,
        mediaId: identity.mediaId,
        chapterNo: 2,
        chapterId: 'ep-2',
        progress: second / 100,
        position: second * 1000,
      );
    }

    final rows = await db.getAllTracking();
    expect(rows, hasLength(1));
    expect(rows.single.position, 30000);
  });

  test('进度比例被限制在 0 到 1 之间', () async {
    final service = SyncService(db, _fakeDio([]), null);

    await service.saveProgress(
      pluginId: 'p',
      mediaType: 'anime',
      mediaId: 'm',
      progress: 4.2,
    );
    await service.saveProgress(
      pluginId: 'p',
      mediaType: 'anime',
      mediaId: 'm2',
      progress: -1.0,
    );

    expect((await db.getTracking(const MediaIdentity(
      pluginId: 'p',
      mediaType: 'anime',
      mediaId: 'm',
    )))?.progress, 1.0);
    expect((await db.getTracking(const MediaIdentity(
      pluginId: 'p',
      mediaType: 'anime',
      mediaId: 'm2',
    )))?.progress, 0.0);
  });

  test('收藏切换按身份隔离', () async {
    final service = SyncService(db, _fakeDio([]), null);
    const anime = MediaIdentity(pluginId: 'bangumi', mediaType: 'anime', mediaId: 'f');
    const manga = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: 'f');

    await service.setFavorite(anime, true);
    await service.setFavorite(manga, true);
    await service.setFavorite(anime, false);

    expect(await service.isFavorite(anime), isFalse);
    expect(await service.isFavorite(manga), isTrue);
  });

  test('远端合并按 pluginId+mediaType+mediaId 写入而非仅 mediaId', () async {
    final service = SyncService(db, _fakeDio([]), 'token');
    await db.saveTracking(LocalTrackingCompanion(
      id: const Value('local-anime'),
      pluginId: const Value('bangumi'),
      mediaType: const Value('anime'),
      mediaId: const Value('shared'),
      chapterNo: const Value(1),
      updatedAt: Value(DateTime(2026, 1, 1)),
    ));

    await service.pullTracking();

    final merged = await db.getTracking(const MediaIdentity(
      pluginId: 'mangadex',
      mediaType: 'manga',
      mediaId: 'shared',
    ));
    expect(merged, isNull);
    expect((await db.getTracking(const MediaIdentity(
      pluginId: 'bangumi',
      mediaType: 'anime',
      mediaId: 'shared',
    )))?.chapterNo, 1);
  });
}
