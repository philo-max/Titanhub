import 'dart:convert';
import 'dart:io';

import '../lib/core/sync/sync_protocol.dart';

void require(bool condition, String name) {
  if (!condition) throw StateError('Failed: $name');
}

void rejects(void Function() action, String name) {
  try {
    action();
  } on SyncProtocolException {
    return;
  }
  throw StateError('Expected protocol rejection: $name');
}

void main() {
  final fixtureFile = File.fromUri(
    Platform.script.resolve('../../../docs/fixtures/sync/protocol-v1-vectors.json'),
  );
  final fixture = jsonDecode(fixtureFile.readAsStringSync()) as Map<String, dynamic>;
  final constants = fixture['constants'] as Map<String, dynamic>;
  require(maxSafeInteger == constants['maxSafeInteger'], 'safe integer limit');
  require(maxSnapshotBytes == constants['maxSnapshotBytes'], 'snapshot limit');
  require(maxRecords == constants['maxRecords'], 'record limit');
  require(maxStringLength == constants['maxStringLength'], 'string limit');
  var count = 1;
  for (final vector in fixture['mediaKey'] as List) {
    final item = vector['item'] as Map<String, dynamic>;
    require(mediaKey(item['mediaType'], item['pluginId'], item['mediaId']) == vector['key'], vector['name']);
    count++;
  }
  for (final vector in fixture['compareVersions'] as List) {
    final a = SyncVersion.fromJson(vector['a']);
    final b = SyncVersion.fromJson(vector['b']);
    require(compareVersions(a, b).sign == vector['sign'], vector['name']);
    require(compareVersions(b, a).sign == -(vector['sign'] as int), vector['name']);
    count++;
  }
  for (final vector in fixture['snapshots'] as List) {
    final input = vector['input'] as String;
    final output = vector['output'] as String?;
    final name = vector['name'] as String;
    if (output == null) {
      rejects(() => parseSnapshot(input), name);
    } else {
      require(encodeSnapshot(parseSnapshot(input)) == output, name);
      require(encodeSnapshot(parseSnapshot(output)) == output, '$name idempotence');
    }
    count++;
  }
  for (final vector in fixture['merges'] as List) {
    List<SyncRecord> merge() => mergeRecords([
          for (final group in vector['groups'] as List)
            [for (final value in group as List) SyncRecord.fromJson(value)],
        ]);
    final output = vector['output'] as String?;
    final name = vector['name'] as String;
    if (output == null) {
      rejects(merge, name);
    } else {
      require(encodeRecords(merge()) == output, name);
    }
    count++;
  }
  const empty = '{"schemaVersion":1,"deviceId":"a","generation":0,"records":[]}';
  final fits = empty + ' ' * (maxSnapshotBytes - empty.length);
  require(parseSnapshot(fits).records.isEmpty, 'snapshot exactly at byte limit');
  rejects(() => parseSnapshot('$fits '), 'snapshot one byte over limit');
  final wide = '{"schemaVersion":1,"deviceId":"${'中' * (maxSnapshotBytes ~/ 3)}","generation":0,"records":[]}';
  rejects(() => parseSnapshot(wide), 'UTF-8 byte limit');
  final records = [
    for (var i = 0; i < maxRecords; i++)
      SyncRecord.favorite(mediaType: 'anime', pluginId: 'p', mediaId: '$i', version: SyncVersion(1, 'a'), updatedAt: 'u', isDeleted: false),
  ];
  require(mergeRecords([records]).length == maxRecords, 'record count at limit');
  final extra = SyncRecord.favorite(mediaType: 'anime', pluginId: 'p', mediaId: 'extra', version: SyncVersion(1, 'a'), updatedAt: 'u', isDeleted: false);
  rejects(() => mergeRecords([records, [extra]]), 'merged record count over limit');
  final duplicateJson = jsonEncode(records.first.toJson());
  rejects(() => parseSnapshot('{"schemaVersion":1,"deviceId":"a","generation":0,"records":[${List.filled(maxRecords + 1, duplicateJson).join(',')}]}'), 'snapshot record count over limit');
  stdout.writeln('PASS: $count shared protocol vectors and 6 size/count boundaries');
}
