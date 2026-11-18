import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/identity/media_identity.dart';
import 'package:titanhub/core/storage/app_database.dart';
import 'package:titanhub/core/sync/sync_protocol.dart';
import 'package:titanhub/core/sync/webdav_sync.dart';
import 'package:titanhub/core/sync/webdav_transport.dart';

void main() {
  final base = Platform.environment['TITANHUB_INTEROP_BASE'];
  test('desktop TypeScript and mobile Dart exchange live DAV data and retry offline edits', () async {
    final db = AppDatabase.forTesting(NativeDatabase.memory());
    final dav = WebDavTransport(WebDavConfig(url: '$base/dav/', username: 'fixture',
        password: 'fixture-password', allowInsecureHttp: true));
    addTearDown(db.close);
    addTearDown(dav.dispose);
    const identity = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: 'interop-title');

    Future<Map<String, dynamic>> control(String action, [Map<String, dynamic>? value]) async {
      final client = HttpClient();
      try {
        final request = await client.postUrl(Uri.parse('$base/control/$action'));
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(value ?? {}));
        final response = await request.close();
        final text = await utf8.decoder.bind(response).join();
        expect(response.statusCode, 200, reason: text);
        return jsonDecode(text) as Map<String, dynamic>;
      } finally {
        client.close(force: true);
      }
    }

    Future<void> progress(int page) => db.saveTracking(LocalTrackingCompanion(
      id: const Value('interop'), pluginId: const Value('mangadex'), mediaType: const Value('manga'),
      mediaId: const Value('interop-title'), chapterId: const Value('chapter-1'),
      chapterNo: const Value(1), progress: Value(page / 100), position: Value(page),
    ));

    expect(await testWebDavConnection(dav), isEmpty);
    await control('write');
    await control('sync');
    await syncWebDav(db, dav);
    expect(await db.getFavorite(identity), isNotNull);
    expect((await db.getTracking(identity))!.position, 4);

    await db.deleteFavorite(identity);
    await progress(8);
    await syncWebDav(db, dav);
    var desktop = await control('sync');
    var records = (desktop['records'] as List).map(SyncRecord.fromJson).toList();
    expect(records.singleWhere((r) => r.kind == SyncRecordKind.favorite).isDeleted, isTrue);
    expect(records.singleWhere((r) => r.kind == SyncRecordKind.progress).position, 8);

    await control('write', {'page': 11, 'progress': 0.11});
    await control('sync');
    await syncWebDav(db, dav);
    expect(await db.getFavorite(identity), isNotNull);
    expect((await db.getTracking(identity))!.position, 11);

    await db.deleteFavorite(identity);
    await control('fail', {'enabled': true});
    await expectLater(syncWebDav(db, dav), throwsA(isA<DavError>()));
    final pending = (await db.getSyncPending())!;
    await db.saveFavorite(const LocalFavoritesCompanion(id: Value('interop'),
        pluginId: Value('mangadex'), mediaType: Value('manga'), mediaId: Value('interop-title')));
    await progress(17);
    await control('fail', {'enabled': false});
    final result = await syncWebDav(db, dav);
    expect(result.pendingChanges, isFalse);
    desktop = await control('sync');
    records = (desktop['records'] as List).map(SyncRecord.fromJson).toList();
    expect(encodeRecords(records), encodeRecords(await db.readSyncRecords()));
    expect(records.singleWhere((r) => r.kind == SyncRecordKind.progress).position, 17);
    expect((desktop['files'] as List).any((entry) => entry[1] == pending.bytes), isTrue);
    expect(await db.getSyncPending(), isNull);
  }, skip: base == null ? 'Set TITANHUB_INTEROP_BASE to the isolated desktop DAV fixture' : false);
}
