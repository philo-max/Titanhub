import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/identity/media_identity.dart';
import 'package:titanhub/core/storage/app_database.dart';

void main() {
  late AppDatabase db;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
  });

  tearDown(() async {
    await db.close();
  });

  Future<void> save(
    MediaIdentity identity, {
    int chapterNo = 1,
    String? chapterId,
    double progress = 0.0,
    int? position,
  }) {
    return db.saveTracking(LocalTrackingCompanion(
      id: Value(identity.key),
      pluginId: Value(identity.pluginId),
      mediaType: Value(identity.mediaType),
      mediaId: Value(identity.mediaId),
      chapterNo: Value(chapterNo),
      chapterId: Value(chapterId),
      progress: Value(progress),
      position: Value(position),
      updatedAt: Value(DateTime.now()),
    ));
  }

  test('不同来源的同名 mediaId 互不覆盖', () async {
    const shared = '12345';
    const fromA = MediaIdentity(pluginId: 'bangumi', mediaType: 'anime', mediaId: shared);
    const fromB = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: shared);

    await save(fromA, chapterNo: 3, chapterId: 'a-3', progress: 0.4, position: 120000);
    await save(fromB, chapterNo: 9, chapterId: 'b-9', progress: 0.8, position: 7);

    final a = await db.getTracking(fromA);
    final b = await db.getTracking(fromB);

    expect(a?.chapterNo, 3);
    expect(a?.chapterId, 'a-3');
    expect(a?.position, 120000);
    expect(b?.chapterNo, 9);
    expect(b?.chapterId, 'b-9');
    expect(b?.position, 7);
    expect(await db.getAllTracking(), hasLength(2));
  });

  test('同一来源不同媒体类型互不覆盖', () async {
    const anime = MediaIdentity(pluginId: 'mixed', mediaType: 'anime', mediaId: '42');
    const manga = MediaIdentity(pluginId: 'mixed', mediaType: 'manga', mediaId: '42');

    await save(anime, chapterNo: 1);
    await save(manga, chapterNo: 2);

    expect((await db.getTracking(anime))?.chapterNo, 1);
    expect((await db.getTracking(manga))?.chapterNo, 2);
  });

  test('重复保存同一身份只更新一行并保留章节位置', () async {
    const identity = MediaIdentity(pluginId: 'bangumi', mediaType: 'anime', mediaId: '77');

    await save(identity, chapterNo: 1, chapterId: 'c1', progress: 0.1, position: 1000);
    await save(identity, chapterNo: 2, chapterId: 'c2', progress: 0.5, position: 300000);

    final all = await db.getAllTracking();
    expect(all, hasLength(1));
    expect(all.single.chapterNo, 2);
    expect(all.single.chapterId, 'c2');
    expect(all.single.position, 300000);
  });

  test('删除只影响指定来源的记录', () async {
    const fromA = MediaIdentity(pluginId: 'bangumi', mediaType: 'anime', mediaId: '9');
    const fromB = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: '9');

    await save(fromA, chapterNo: 5);
    await save(fromB, chapterNo: 6);

    await db.deleteTracking(fromA);

    expect(await db.getTracking(fromA), isNull);
    expect((await db.getTracking(fromB))?.chapterNo, 6);
  });

  test('收藏按来源+类型+作品隔离并可单独取消', () async {
    const fromA = MediaIdentity(pluginId: 'bangumi', mediaType: 'anime', mediaId: '5');
    const fromB = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: '5');

    await db.saveFavorite(LocalFavoritesCompanion(
      id: Value(fromA.key),
      pluginId: Value(fromA.pluginId),
      mediaType: Value(fromA.mediaType),
      mediaId: Value(fromA.mediaId),
    ));
    await db.saveFavorite(LocalFavoritesCompanion(
      id: Value(fromB.key),
      pluginId: Value(fromB.pluginId),
      mediaType: Value(fromB.mediaType),
      mediaId: Value(fromB.mediaId),
    ));

    await db.deleteFavorite(fromA);

    expect(await db.getFavorite(fromA), isNull);
    expect(await db.getFavorite(fromB), isNotNull);
    expect(await db.getAllFavorites(), hasLength(1));
  });

  test('重复收藏同一身份不会产生重复行', () async {
    const identity = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: 'x1');

    for (var i = 0; i < 3; i++) {
      await db.saveFavorite(LocalFavoritesCompanion(
        id: Value('stale-$i'),
        pluginId: Value(identity.pluginId),
        mediaType: Value(identity.mediaType),
        mediaId: Value(identity.mediaId),
      ));
    }

    expect(await db.getAllFavorites(), hasLength(1));
  });

  test('最近观看按更新时间返回，用于继续阅读入口', () async {
    const older = MediaIdentity(pluginId: 'bangumi', mediaType: 'anime', mediaId: 'old');
    const newer = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: 'new');

    await db.saveTracking(LocalTrackingCompanion(
      id: Value(older.key),
      pluginId: Value(older.pluginId),
      mediaType: Value(older.mediaType),
      mediaId: Value(older.mediaId),
      chapterNo: Value(1),
      updatedAt: Value(DateTime(2026, 1, 1)),
    ));
    await db.saveTracking(LocalTrackingCompanion(
      id: Value(newer.key),
      pluginId: Value(newer.pluginId),
      mediaType: Value(newer.mediaType),
      mediaId: Value(newer.mediaId),
      chapterNo: Value(2),
      updatedAt: Value(DateTime(2026, 5, 1)),
    ));

    final latest = await db.getLatestTracking();
    expect(latest?.mediaId, 'new');
  });

  group('媒体类型解析', () {
    test('优先使用来源声明的类型', () {
      expect(resolveMediaType(types: ['manga'], mediaId: 'anime-1'), 'manga');
      expect(resolveMediaType(types: ['anime'], mediaId: 'manga-1'), 'anime');
    });

    test('来源未声明时按作品 ID 关键字回退', () {
      expect(resolveMediaType(mediaId: 'manga-101'), 'manga');
      expect(resolveMediaType(mediaId: 'novel-9'), 'novel');
      expect(resolveMediaType(mediaId: 'movie-3'), 'movie');
      expect(resolveMediaType(mediaId: 'tv-3'), 'anime');
    });
  });
}
