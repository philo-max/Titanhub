import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sync/sync_protocol.dart';

const fixturePath = '../../docs/fixtures/sync/protocol-v1-vectors.json';

Map<String, Object?> favorite(int counter, {String deviceId = 'a', bool isDeleted = false}) => {
      'kind': 'favorite',
      'key': '["anime","p","m"]',
      'mediaType': 'anime',
      'pluginId': 'p',
      'mediaId': 'm',
      'version': {'counter': counter, 'deviceId': deviceId},
      'updatedAt': '2026-01-01',
      'isDeleted': isDeleted,
    };

List<SyncRecord> records(List<Map<String, Object?>> values) => values.map(SyncRecord.fromJson).toList();

String encodeAll(List<SyncRecord> values) => encodeRecords(values);

void main() {
  final fixture = jsonDecode(File(fixturePath).readAsStringSync()) as Map<String, dynamic>;

  group('shared vectors', () {
    test('constants match desktop', () {
      final constants = fixture['constants'] as Map<String, dynamic>;
      expect(maxSafeInteger, constants['maxSafeInteger']);
      expect(maxSnapshotBytes, constants['maxSnapshotBytes']);
      expect(maxRecords, constants['maxRecords']);
      expect(maxStringLength, constants['maxStringLength']);
    });

    test('media keys', () {
      for (final vector in fixture['mediaKey'] as List) {
        final item = vector['item'] as Map<String, dynamic>;
        expect(mediaKey(item['mediaType'] as String, item['pluginId'] as String, item['mediaId'] as String),
            vector['key'],
            reason: vector['name'] as String);
      }
    });

    test('version comparison', () {
      for (final vector in fixture['compareVersions'] as List) {
        final a = SyncVersion.fromJson(vector['a']);
        final b = SyncVersion.fromJson(vector['b']);
        expect(compareVersions(a, b).sign, vector['sign'], reason: vector['name'] as String);
        expect(compareVersions(b, a).sign, -(vector['sign'] as int), reason: vector['name'] as String);
      }
    });

    test('snapshots', () {
      for (final vector in fixture['snapshots'] as List) {
        final name = vector['name'] as String;
        final input = vector['input'] as String;
        final output = vector['output'] as String?;
        if (output == null) {
          expect(() => parseSnapshot(input), throwsA(isA<SyncProtocolException>()), reason: name);
        } else {
          final snapshot = parseSnapshot(input);
          expect(encodeSnapshot(snapshot), output, reason: name);
          expect(encodeSnapshot(parseSnapshot(output)), output, reason: name);
        }
      }
    });

    test('merges', () {
      for (final vector in fixture['merges'] as List) {
        final name = vector['name'] as String;
        final output = vector['output'] as String?;
        List<SyncRecord> run() => mergeRecords([
              for (final group in vector['groups'] as List) [for (final value in group as List) SyncRecord.fromJson(value)]
            ]);
        if (output == null) {
          expect(run, throwsA(isA<SyncProtocolException>()), reason: name);
        } else {
          expect(encodeAll(run()), output, reason: name);
        }
      }
    });
  });

  group('merge laws', () {
    final a = records([favorite(1)]);
    final b = records([favorite(2, deviceId: 'b', isDeleted: true)]);
    final c = records([favorite(3)]);

    test('commutative, associative, idempotent with tombstones', () {
      expect(encodeAll(mergeRecords([a, b])), encodeAll(mergeRecords([b, a])));
      expect(encodeAll(mergeRecords([mergeRecords([a, b]), c])), encodeAll(mergeRecords([a, mergeRecords([b, c])])));
      expect(encodeAll(mergeRecords([b, b])), encodeAll(b));
      expect(mergeRecords([a, b]).single.isDeleted, isTrue);
      expect(mergeRecords([b, c]).single.isDeleted, isFalse);
    });

    test('rejects equal versions with different payloads', () {
      expect(() => mergeRecords([a, records([favorite(1, isDeleted: true)])]), throwsA(isA<SyncProtocolException>()));
    });

    test('rejects more than maxRecords merged records', () {
      List<SyncRecord> batch(int from, int count) => [
            for (var i = from; i < from + count; i++)
              SyncRecord.favorite(mediaType: 'anime', pluginId: 'p', mediaId: '$i', version: SyncVersion(1, 'a'),
                  updatedAt: 'u', isDeleted: false)
          ];
      expect(mergeRecords([batch(0, maxRecords)]), hasLength(maxRecords));
      expect(() => mergeRecords([batch(0, maxRecords), batch(maxRecords, 1)]), throwsA(isA<SyncProtocolException>()));
    });
  });

  group('snapshot limits', () {
    const empty = '{"schemaVersion":1,"deviceId":"a","generation":0,"records":[]}';

    test('measures size in UTF-8 bytes', () {
      final fits = empty + ' ' * (maxSnapshotBytes - empty.length);
      expect(parseSnapshot(fits).records, isEmpty);
      expect(() => parseSnapshot('$fits '), throwsA(isA<SyncProtocolException>()));
      final item = jsonEncode({...favorite(1), 'updatedAt': '中' * maxStringLength});
      String wide(int count) =>
          '{"schemaVersion":1,"deviceId":"a","generation":0,"records":[${List.filled(count, item).join(',')}]}';
      expect(parseSnapshot(wide(300)).records, hasLength(1));
      expect(wide(342).length, lessThan(maxSnapshotBytes));
      expect(() => parseSnapshot(wide(342)), throwsA(isA<SyncProtocolException>()));
    });

    test('rejects record arrays longer than maxRecords before merging', () {
      final items = List.filled(maxRecords + 1, jsonEncode(favorite(1))).join(',');
      expect(() => parseSnapshot('{"schemaVersion":1,"deviceId":"a","generation":0,"records":[$items]}'),
          throwsA(isA<SyncProtocolException>()));
    });

    test('rejects malformed json as protocol error', () {
      expect(() => parseSnapshot('{'), throwsA(isA<SyncProtocolException>()));
    });
  });

  group('constructors', () {
    test('favorite and progress derive the full media key and keep versions separate', () {
      final fav = SyncRecord.favorite(
          mediaType: 'novel', pluginId: 'p"x', mediaId: 'é\n', version: SyncVersion(5, 'a'), updatedAt: 'u', isDeleted: true);
      final prog = SyncRecord.progress(
          mediaType: 'novel', pluginId: 'p"x', mediaId: 'é\n', version: SyncVersion(1, 'b'), updatedAt: 'u',
          chapterId: 'c', chapterNo: 2, progress: 0.5, position: 0.25, status: 'watching');
      expect(fav.key, r'["novel","p\"x","é\n"]');
      expect(prog.key, fav.key);
      final merged = mergeRecords([[fav], [prog]]);
      expect(merged.map((r) => r.kind), [SyncRecordKind.favorite, SyncRecordKind.progress]);
      expect(merged.map((r) => r.version.counter), [5, 1]);
    });

    test('validate like parsed records', () {
      expect(() => SyncVersion(maxSafeInteger + 1, 'a'), throwsA(isA<SyncProtocolException>()));
      expect(() => SyncVersion(1, ''), throwsA(isA<SyncProtocolException>()));
      expect(
          () => SyncRecord.progress(
              mediaType: 'manga', pluginId: 'p', mediaId: 'm', version: SyncVersion(1, 'a'), updatedAt: 'u',
              chapterId: 'c', chapterNo: 1, progress: 0.5, position: 1.5, status: 's'),
          throwsA(isA<SyncProtocolException>()));
    });
  });
}
