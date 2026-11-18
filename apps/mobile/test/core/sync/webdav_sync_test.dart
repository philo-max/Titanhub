import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/identity/media_identity.dart';
import 'package:titanhub/core/storage/app_database.dart';
import 'package:titanhub/core/sync/sync_protocol.dart';
import 'package:titanhub/core/sync/webdav_sync.dart';
import 'package:titanhub/core/sync/webdav_transport.dart';

import 'memory_webdav.dart';

const _identity = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: 'a');

String _gen(int value) => '${value.toString().padLeft(20, '0')}.json';

Future<void> _favorite(AppDatabase db) => db.saveFavorite(LocalFavoritesCompanion(
      id: Value(_identity.key),
      pluginId: const Value('mangadex'),
      mediaType: const Value('manga'),
      mediaId: const Value('a'),
    ));

void main() {
  late AppDatabase db;
  late MemoryWebDav dav;
  late String ownDir;

  setUp(() async {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    dav = MemoryWebDav();
    ownDir = '$webDavDevicesPath${(await db.getSyncDevice()).deviceId}/';
  });
  tearDown(() => db.close());

  test('首次同步发布本机快照并完成 pending', () async {
    await _favorite(db);

    final result = await syncWebDav(db, dav);

    final snapshot = parseSnapshot(dav.files['$ownDir${_gen(1)}']!);
    expect(snapshot.generation, 1);
    expect(snapshot.records.single.mediaId, 'a');
    expect(await db.getSyncPending(), isNull);
    expect(result.pendingChanges, isFalse);
    expect(result.lastSuccessAt, isNotNull);
    expect(dav.files.keys.where((k) => k.endsWith('.tmp')), isEmpty);
    expect(dav.log.where((l) => l.startsWith('PUT ')).single, endsWith('.tmp'));
  });

  test('合并其他设备快照且从不写入其目录', () async {
    final other = AppDatabase.forTesting(NativeDatabase.memory());
    addTearDown(other.close);
    await _favorite(other);
    final otherPending = await other.prepareSyncPublication(const []);
    final otherDir = '$webDavDevicesPath${(await other.getSyncDevice()).deviceId}/';
    dav.seed('$otherDir${_gen(otherPending.generation)}', otherPending.bytes);

    await syncWebDav(db, dav);

    expect(await db.getFavorite(_identity), isNotNull);
    expect(dav.files['$otherDir${_gen(otherPending.generation)}'], otherPending.bytes);
    final writes = dav.log.where((l) => !l.startsWith('GET ') && !l.startsWith('PROPFIND '));
    expect(writes.where((l) => l.contains(otherDir)), isEmpty);
  });

  test('先重发旧 pending 再发布新一代', () async {
    await _favorite(db);
    final stale = await db.prepareSyncPublication(const []);

    await syncWebDav(db, dav);

    expect(dav.files['$ownDir${_gen(stale.generation)}'], stale.bytes);
    expect(dav.files['$ownDir${_gen(stale.generation + 1)}'], isNotNull);
    final puts = dav.log.where((l) => l.startsWith('PUT ')).toList();
    expect(puts.first, contains(_gen(stale.generation).replaceAll('.json', '.')));
    expect(await db.getSyncPending(), isNull);
  });

  test('同代文件内容不同视为冲突，不覆盖且保留 pending', () async {
    await _favorite(db);
    final pending = await db.prepareSyncPublication(const []);
    final other = encodeSnapshot(SyncSnapshot(deviceId: (await db.getSyncDevice()).deviceId,
        generation: pending.generation, records: const []));
    dav.seed('$ownDir${_gen(1)}', other);

    await expectLater(syncWebDav(db, dav), throwsA(isA<WebDavSyncException>()));

    expect(dav.files['$ownDir${_gen(1)}'], other);
    expect(await db.getSyncPending(), isNotNull);
  });

  test('远端坏快照直接失败且不发布任何内容', () async {
    dav.seed('${webDavDevicesPath}other-device/${_gen(1)}', '{"broken":');

    await expectLater(syncWebDav(db, dav), throwsA(anything));

    expect(dav.log.where((l) => l.startsWith('PUT ') || l.startsWith('MOVE ')), isEmpty);
  });

  test('非法设备目录名直接失败', () async {
    dav.seed('${webDavDevicesPath}bad.name/${_gen(1)}', '{}');

    await expectLater(syncWebDav(db, dav), throwsA(isA<WebDavSyncException>()));
  });

  test('快照身份与目录不符时失败', () async {
    final other = AppDatabase.forTesting(NativeDatabase.memory());
    addTearDown(other.close);
    final pending = await other.prepareSyncPublication(const []);
    dav.seed('${webDavDevicesPath}impostor/${_gen(pending.generation)}', pending.bytes);

    await expectLater(syncWebDav(db, dav), throwsA(isA<WebDavSyncException>()));
  });

  test('清理只保留最近两代并删除残留 tmp', () async {
    for (var i = 0; i < 3; i++) {
      await syncWebDav(db, dav);
    }
    dav.seed('$ownDir${_gen(9)}.leftover.tmp', 'x');
    await syncWebDav(db, dav);

    final own = dav.files.keys.where((k) => k.startsWith(ownDir)).toList()..sort();
    expect(own, ['$ownDir${_gen(3)}', '$ownDir${_gen(4)}']);
  });

  test('MOVE 超时但实际已落盘时按成功处理', () async {
    var failed = false;
    dav.failAfter = (method, key) {
      if (method != 'MOVE' || failed) return null;
      failed = true;
      return const DavException('WebDAV request timed out');
    };

    await syncWebDav(db, dav);

    expect(failed, isTrue);
    expect(dav.files['$ownDir${_gen(1)}'], isNotNull);
    expect(await db.getSyncPending(), isNull);
  });

  test('网络失败重试一次', () async {
    var failures = 0;
    dav.failBefore = (method, key) {
      if (method != 'PUT' || failures > 0) return null;
      failures++;
      return const DavException('WebDAV network or response error');
    };

    await syncWebDav(db, dav);

    expect(dav.log.where((l) => l.startsWith('PUT ')), hasLength(2));
    expect(await db.getSyncPending(), isNull);
  });

  test('HTTP 错误不重试、不吞掉并保留 pending', () async {
    dav.failBefore = (method, key) => method == 'PUT' ? DavError(403, method) : null;

    await expectLater(syncWebDav(db, dav), throwsA(isA<DavError>()));

    expect(dav.log.where((l) => l.startsWith('PUT ')), hasLength(1));
    expect(await db.getSyncPending(), isNotNull);
  });

  test('清理失败只给出警告', () async {
    await syncWebDav(db, dav);
    await syncWebDav(db, dav);
    dav.failBefore = (method, key) => method == 'DELETE' ? DavError(500, method) : null;

    final result = await syncWebDav(db, dav);

    expect(result.warnings, hasLength(1));
    expect(await db.getSyncPending(), isNull);
  });

  test('连接测试走完写入流程并清理临时目录', () async {
    final warnings = await testWebDavConnection(dav);

    expect(warnings, isEmpty);
    expect(dav.log, contains(predicate<String>((l) => l.startsWith('MOVE Titanhub-test-'))));
    expect(dav.files, isEmpty);
    expect(dav.dirs, {''});
  });

  test('连接测试写入失败时抛出并仍尝试清理', () async {
    dav.failBefore = (method, key) => method == 'PUT' ? DavError(507, method) : null;

    await expectLater(testWebDavConnection(dav), throwsA(isA<DavError>()));

    expect(dav.dirs, {''});
  });
}
