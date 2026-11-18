import 'dart:io';

import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqlite3/sqlite3.dart' as raw;
import 'package:titanhub/core/identity/media_identity.dart';
import 'package:titanhub/core/storage/app_database.dart';
import 'package:titanhub/core/sync/sync_protocol.dart';

void main() {
  const identity = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: 'a');
  late AppDatabase db;
  setUp(() => db = AppDatabase.forTesting(NativeDatabase.memory()));
  tearDown(() => db.close());

  Future<void> favorite() => db.saveFavorite(LocalFavoritesCompanion(
        id: Value(identity.key), pluginId: const Value('mangadex'),
        mediaType: const Value('manga'), mediaId: const Value('a'),
      ));

  test('offline deletion survives remote stale favorite and repeated merge', () async {
    await favorite();
    final old = await db.readSyncRecords();
    await db.deleteFavorite(identity);
    final pending = await db.prepareSyncPublication(old);
    expect(parseSnapshot(pending.bytes).records.single.isDeleted, isTrue);
    expect(await db.getFavorite(identity), isNull);
    await db.completeSyncPublication(pending);
    await db.prepareSyncPublication(old);
    expect(await db.getFavorite(identity), isNull);
    expect((await db.readSyncRecords()).single.isDeleted, isTrue);
  });

  test('pending bytes survive newer local edits and completion stays dirty', () async {
    await favorite();
    final pending = await db.prepareSyncPublication([]);
    await db.deleteFavorite(identity);
    expect((await db.getSyncPending())!.bytes, pending.bytes);
    await db.completeSyncPublication(pending);
    final state = await db.getSyncDevice();
    expect(state.counter, greaterThan(state.publishedCounter));
    final next = await db.prepareSyncPublication([]);
    expect(next.generation, pending.generation + 1);
    expect(parseSnapshot(next.bytes).records.single.isDeleted, isTrue);
  });

  test('video milliseconds convert to fractional seconds and back', () async {
    await db.saveTracking(const LocalTrackingCompanion(
      id: Value('v'), pluginId: Value('p'), mediaType: Value('anime'),
      mediaId: Value('v'), chapterId: Value('ep'), position: Value(90125),
    ));
    expect((await db.readSyncRecords()).single.position, 90.125);
    final remote = SyncRecord.progress(mediaType: 'anime', pluginId: 'p', mediaId: 'v',
      version: SyncVersion(100, 'desktop'), updatedAt: '2026-10-31T00:00:00.123Z',
      chapterId: 'ep', chapterNo: 1, progress: 0.5, position: 120.75, status: 'watching');
    await db.prepareSyncPublication([remote]);
    final row = await db.getTracking(const MediaIdentity(pluginId: 'p', mediaType: 'anime', mediaId: 'v'));
    expect(row!.position, 120750);
    expect((await db.readSyncRecords()).single.toJson(), remote.toJson());
  });

  test('novel position ratio takes precedence without integer truncation', () async {
    final remote = SyncRecord.progress(mediaType: 'novel', pluginId: 'p', mediaId: 'n',
      version: SyncVersion(10, 'desktop'), updatedAt: '2026-10-31T00:00:00Z',
      chapterId: 'c', chapterNo: 1, progress: 0.1, position: 0.75, status: 'reading');
    await db.prepareSyncPublication([remote]);
    final row = await db.getTracking(const MediaIdentity(pluginId: 'p', mediaType: 'novel', mediaId: 'n'));
    expect(row!.progress, 0.75);
    expect(row.position, isNull);
    expect((await db.readSyncRecords()).single.position, 0.75);
  });

  test('equal version conflict rolls back business state and generation', () async {
    await favorite();
    final old = (await db.readSyncRecords()).single;
    final conflict = SyncRecord.fromJson({...old.toJson(), 'isDeleted': true});
    final before = await db.getSyncDevice();
    await expectLater(db.prepareSyncPublication([conflict]), throwsA(isA<SyncProtocolException>()));
    expect(await db.getFavorite(identity), isNotNull);
    expect((await db.getSyncDevice()).generation, before.generation);
  });

  test('device identity canonical milliseconds and pending persist after reopen', () async {
    final dir = await Directory.systemTemp.createTemp('titan-sync-test');
    final file = File('${dir.path}/state.sqlite');
    final first = AppDatabase.forTesting(NativeDatabase(file));
    final device = await first.getSyncDevice();
    final pending = await first.prepareSyncPublication([]);
    await first.close();
    final second = AppDatabase.forTesting(NativeDatabase(file));
    expect((await second.getSyncDevice()).deviceId, device.deviceId);
    expect((await second.getSyncPending())!.bytes, pending.bytes);
    await second.close();
  });

  test('v2 database imports existing rows once and retains the upgrade data', () async {
    final dir = await Directory.systemTemp.createTemp('titan-sync-v2');
    final file = File('${dir.path}/state.sqlite');
    final previous = AppDatabase.forTesting(NativeDatabase(file));
    await previous.saveFavorite(const LocalFavoritesCompanion(
      id: Value('old'), pluginId: Value('mangadex'), mediaType: Value('manga'), mediaId: Value('a'),
    ));
    await previous.close();
    final fixture = raw.sqlite3.open(file.path);
    fixture.execute('DROP TABLE sync_device; DROP TABLE sync_records; DROP TABLE sync_pending; PRAGMA user_version=2;');
    fixture.close();
    final upgraded = AppDatabase.forTesting(NativeDatabase(file));
    expect(await upgraded.getFavorite(identity), isNotNull);
    final first = await upgraded.prepareSyncPublication([]);
    expect(parseSnapshot(first.bytes).records.single.isDeleted, isFalse);
    await upgraded.completeSyncPublication(first);
    await upgraded.deleteFavorite(identity);
    final second = await upgraded.prepareSyncPublication([]);
    expect(parseSnapshot(second.bytes).records.single.isDeleted, isTrue);
    expect((await upgraded.readSyncRecords()).length, 1);
    await upgraded.close();
  });
}
