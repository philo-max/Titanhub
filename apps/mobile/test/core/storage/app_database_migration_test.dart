import 'dart:io';

import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart' as raw;
import 'package:titanhub/core/identity/media_identity.dart';
import 'package:titanhub/core/storage/app_database.dart';

const String _v1Schema = '''
CREATE TABLE local_tracking (
  id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  chapter_no INTEGER NOT NULL DEFAULT 0,
  chapter_id TEXT NULL,
  progress REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'watching',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (id)
);
CREATE TABLE local_favorites (
  id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (id)
);
PRAGMA user_version = 1;
''';

void main() {
  late Directory tempDir;
  late File dbFile;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('titanhub-db-migration');
    dbFile = File('${tempDir.path}/titanhub.sqlite');

    final legacy = raw.sqlite3.open(dbFile.path);
    legacy.execute(_v1Schema);
    legacy.execute('''
      INSERT INTO local_tracking (id, media_id, plugin_id, media_type, chapter_no, chapter_id, progress, status, updated_at)
      VALUES ('old-a', 'shared-1', 'bangumi', 'anime', 12, 'ep-12', 0.42, 'watching', 1700000000)
    ''');
    legacy.execute('''
      INSERT INTO local_tracking (id, media_id, plugin_id, media_type, chapter_no, chapter_id, progress, status, updated_at)
      VALUES ('old-b', 'shared-1', 'mangadex', 'manga', 7, 'ch-7', 0.9, 'watching', 1700000500)
    ''');
    legacy.execute('''
      INSERT INTO local_tracking (id, media_id, plugin_id, media_type, chapter_no, chapter_id, progress, status, updated_at)
      VALUES ('dup-1', 'dup-9', 'bangumi', 'anime', 1, 'ep-1', 0.1, 'watching', 1700000100)
    ''');
    legacy.execute('''
      INSERT INTO local_tracking (id, media_id, plugin_id, media_type, chapter_no, chapter_id, progress, status, updated_at)
      VALUES ('dup-2', 'dup-9', 'bangumi', 'anime', 5, 'ep-5', 0.6, 'watching', 1700000900)
    ''');
    legacy.execute('''
      INSERT INTO local_favorites (id, media_id, plugin_id, media_type, created_at)
      VALUES ('fav-1', 'shared-1', 'bangumi', 'anime', 1700000000)
    ''');
    legacy.execute('''
      INSERT INTO local_favorites (id, media_id, plugin_id, media_type, created_at)
      VALUES ('fav-2', 'shared-1', 'mangadex', 'manga', 1700000100)
    ''');
    legacy.close();
  });

  tearDown(() async {
    await tempDir.delete(recursive: true);
  });

  test('旧版单主键库升级后保留按来源隔离的两条进度', () async {
    final db = AppDatabase.forTesting(NativeDatabase(dbFile));
    addTearDown(db.close);

    final anime = await db.getTracking(const MediaIdentity(
      pluginId: 'bangumi',
      mediaType: 'anime',
      mediaId: 'shared-1',
    ));
    final manga = await db.getTracking(const MediaIdentity(
      pluginId: 'mangadex',
      mediaType: 'manga',
      mediaId: 'shared-1',
    ));

    expect(anime?.chapterNo, 12);
    expect(anime?.chapterId, 'ep-12');
    expect(anime?.progress, closeTo(0.42, 0.001));
    expect(manga?.chapterNo, 7);
    expect(manga?.chapterId, 'ch-7');
  });

  test('升级时同一身份的历史重复行合并为最新一条', () async {
    final db = AppDatabase.forTesting(NativeDatabase(dbFile));
    addTearDown(db.close);

    final dup = await db.getTracking(const MediaIdentity(
      pluginId: 'bangumi',
      mediaType: 'anime',
      mediaId: 'dup-9',
    ));

    expect(dup?.chapterNo, 5);
    expect(dup?.chapterId, 'ep-5');
    expect(await db.getAllTracking(), hasLength(3));
  });

  test('升级后收藏仍按来源保留，旧数据未被删除', () async {
    final db = AppDatabase.forTesting(NativeDatabase(dbFile));
    addTearDown(db.close);

    final favorites = await db.getAllFavorites();
    expect(favorites, hasLength(2));
    expect(
      favorites.map((f) => f.pluginId).toSet(),
      {'bangumi', 'mangadex'},
    );
  });

  test('升级后写入新进度不会破坏旧记录', () async {
    final db = AppDatabase.forTesting(NativeDatabase(dbFile));
    addTearDown(db.close);

    const identity = MediaIdentity(
      pluginId: 'bangumi',
      mediaType: 'anime',
      mediaId: 'shared-1',
    );
    await db.saveTracking(LocalTrackingCompanion(
      id: const Value('bangumi\u0000anime\u0000shared-1'),
      pluginId: const Value('bangumi'),
      mediaType: const Value('anime'),
      mediaId: const Value('shared-1'),
      chapterNo: const Value(13),
      chapterId: const Value('ep-13'),
      progress: const Value(0.5),
      position: const Value(600000),
      updatedAt: Value(DateTime(2026, 10, 28)),
    ));

    final updated = await db.getTracking(identity);
    expect(updated?.chapterNo, 13);
    expect(updated?.position, 600000);
    expect(await db.getAllTracking(), hasLength(3));
  });
}
