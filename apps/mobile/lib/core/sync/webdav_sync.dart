import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

import '../storage/app_database.dart';
import 'sync_protocol.dart';
import 'webdav_transport.dart';

const String webDavDevicesPath = 'Titanhub/sync/v1/devices/';
const List<String> _syncDirectories = [
  'Titanhub/',
  'Titanhub/sync/',
  'Titanhub/sync/v1/',
  webDavDevicesPath,
];
const int _keptGenerations = 2;
const int _generationDigits = 20;
const int _publishAttempts = 2;
final RegExp _deviceIdPattern = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
final RegExp _generationFilePattern = RegExp(r'^\d{20}\.json$');
final RegExp _retryablePattern = RegExp('timed out|network', caseSensitive: false);

class WebDavSyncException implements Exception {
  const WebDavSyncException(this.message);

  final String message;

  @override
  String toString() => message;
}

class WebDavSyncResult {
  const WebDavSyncResult({
    required this.lastSuccessAt,
    required this.pendingChanges,
    required this.warnings,
  });

  final DateTime? lastSuccessAt;
  final bool pendingChanges;
  final List<String> warnings;
}

class _Generation {
  const _Generation(this.path, this.generation);

  final String path;
  final int generation;
}

String _lastSegment(WebDavTransport dav, String path) {
  final segments = dav.resolve(path).pathSegments.where((s) => s.isNotEmpty);
  return segments.isEmpty ? '' : segments.last;
}

int? _generationOf(WebDavTransport dav, String path) {
  final name = _lastSegment(dav, path);
  if (!name.endsWith('.json')) return null;
  if (!_generationFilePattern.hasMatch(name)) {
    throw const WebDavSyncException('Invalid WebDAV generation filename');
  }
  final value = int.tryParse(name.substring(0, _generationDigits));
  if (value == null || value > maxSafeInteger) {
    throw const WebDavSyncException('Invalid WebDAV generation');
  }
  return value;
}

List<_Generation> _committed(WebDavTransport dav, Iterable<DavEntry> files) {
  final result = <_Generation>[];
  for (final file in files) {
    final generation = _generationOf(dav, file.path);
    if (generation != null) result.add(_Generation(file.path, generation));
  }
  result.sort((a, b) => b.generation.compareTo(a.generation));
  return result;
}

Future<List<DavEntry>> _files(WebDavTransport dav, String directory) async =>
    (await dav.list(directory)).where((e) => !e.collection).toList();

Future<void> _ensureDirectories(WebDavTransport dav) async {
  for (final directory in _syncDirectories) {
    await dav.mkdir(directory);
  }
}

Future<SyncSnapshot?> _readLatest(WebDavTransport dav, String directory, String deviceId) async {
  for (var attempt = 0; attempt < 2; attempt++) {
    final generations = _committed(dav, await _files(dav, directory));
    if (generations.isEmpty) {
      if (attempt > 0) break;
      return null;
    }
    final highest = generations.first;
    final response = await dav.request('GET', highest.path, allow404: true);
    if (response.status == 404) continue;
    final snapshot = parseSnapshot(response.bytes);
    if (snapshot.deviceId != deviceId || snapshot.generation != highest.generation) {
      throw const WebDavSyncException('WebDAV snapshot identity mismatch');
    }
    return snapshot;
  }
  throw const WebDavSyncException('WebDAV generation disappeared');
}

Future<List<SyncRecord>> _readRemote(WebDavTransport dav) async {
  var records = <SyncRecord>[];
  for (final entry in await dav.list(webDavDevicesPath)) {
    if (!entry.collection) continue;
    final deviceId = _lastSegment(dav, entry.path);
    if (!_deviceIdPattern.hasMatch(deviceId)) {
      throw const WebDavSyncException('Invalid WebDAV device directory');
    }
    final snapshot = await _readLatest(dav, entry.path, deviceId);
    if (snapshot != null) records = mergeRecords([records, snapshot.records]);
  }
  return records;
}

Future<bool> _verifyFinal(WebDavTransport dav, String path, String bytes) async {
  final response = await dav.request('GET', path, allow404: true);
  if (response.status == 404) return false;
  if (response.bytes != bytes) {
    throw const WebDavSyncException('WebDAV immutable generation conflict');
  }
  return true;
}

bool _isRetryable(Object error) =>
    error is DavException && error is! DavError && _retryablePattern.hasMatch(error.message);

Future<void> _publish(
  WebDavTransport dav,
  String directory,
  SyncPendingPublication pending,
) async {
  final name = pending.generation.toString().padLeft(_generationDigits, '0');
  final finalPath = '$directory$name.json';
  final digest = sha256.convert(utf8.encode(pending.bytes)).toString();
  final tmpPath = '$directory$name.$digest.tmp';
  await dav.mkdir(directory);
  if (await _verifyFinal(dav, finalPath, pending.bytes)) return;
  for (var attempt = 0; attempt < _publishAttempts; attempt++) {
    try {
      final old = await dav.request('GET', tmpPath, allow404: true);
      if (old.status != 404 && old.bytes != pending.bytes) {
        throw const WebDavSyncException('WebDAV temporary publication conflict');
      }
      if (old.status == 404) {
        await dav.request('PUT', tmpPath, body: pending.bytes, headers: const {
          'Content-Type': 'application/json',
          'If-None-Match': '*',
        });
      }
      await dav.request('MOVE', tmpPath, headers: {
        'Destination': dav.resolve(finalPath).toString(),
        'Overwrite': 'F',
      });
      if (!await _verifyFinal(dav, finalPath, pending.bytes)) {
        throw const WebDavSyncException('WebDAV publication missing after MOVE');
      }
      return;
    } catch (error) {
      if (await _verifyFinal(dav, finalPath, pending.bytes)) return;
      if (attempt == _publishAttempts - 1 || !_isRetryable(error)) rethrow;
    }
  }
}

Future<List<String>> _cleanup(WebDavTransport dav, String directory) async {
  try {
    final files = await _files(dav, directory);
    final remove = [
      ..._committed(dav, files).skip(_keptGenerations).map((e) => e.path),
      ...files.where((e) => e.path.endsWith('.tmp')).map((e) => e.path),
    ];
    for (final path in remove) {
      await dav.request('DELETE', path);
    }
    return const [];
  } on Exception {
    return const ['WebDAV 旧版本清理失败，已保留旧文件'];
  }
}

final Expando<bool> _runningDatabases = Expando<bool>();

Future<WebDavSyncResult> syncWebDav(AppDatabase db, WebDavTransport dav) async {
  if (_runningDatabases[db] == true) {
    throw const WebDavSyncException('已有 WebDAV 任务正在进行');
  }
  _runningDatabases[db] = true;
  try {
    return await _syncWebDav(db, dav);
  } finally {
    _runningDatabases[db] = null;
  }
}

Future<WebDavSyncResult> _syncWebDav(AppDatabase db, WebDavTransport dav) async {
  await _ensureDirectories(dav);
  final records = await _readRemote(dav);
  final device = await db.getSyncDevice();
  if (!_deviceIdPattern.hasMatch(device.deviceId)) {
    throw const WebDavSyncException('Invalid local sync device id');
  }
  final directory = '$webDavDevicesPath${device.deviceId}/';
  final previous = await db.getSyncPending();
  if (previous != null) {
    await _publish(dav, directory, previous);
    await db.completeSyncPublication(previous);
  }
  final pending = await db.prepareSyncPublication(records);
  await _publish(dav, directory, pending);
  await db.completeSyncPublication(pending);
  final warnings = await _cleanup(dav, directory);
  final state = await db.getSyncDevice();
  return WebDavSyncResult(
    lastSuccessAt: state.lastSuccessAt,
    pendingChanges: state.counter > state.publishedCounter,
    warnings: warnings,
  );
}

String _randomHex(int length) {
  final random = Random.secure();
  return List.generate(length, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

Future<List<String>> testWebDavConnection(WebDavTransport dav) async {
  await dav.list(dav.root.toString());
  final directory = 'Titanhub-test-${_randomHex(16)}/';
  final probeTmp = '${directory}probe.tmp';
  final probeFinal = '${directory}probe.json';
  final bytes = _randomHex(32);
  final warnings = <String>[];
  try {
    await dav.mkdir(directory);
    await dav.list(directory);
    await dav.request('PUT', probeTmp, body: bytes);
    if ((await dav.request('GET', probeTmp)).bytes != bytes) {
      throw const WebDavSyncException('WebDAV test read mismatch');
    }
    await dav.request('MOVE', probeTmp, headers: {
      'Destination': dav.resolve(probeFinal).toString(),
      'Overwrite': 'F',
    });
    if (!await _verifyFinal(dav, probeFinal, bytes)) {
      throw const WebDavSyncException('WebDAV test MOVE verification failed');
    }
  } finally {
    for (final path in [probeTmp, probeFinal, directory]) {
      try {
        await dav.request('DELETE', path, allow404: true);
      } on Exception {
        warnings.add('WebDAV 测试临时文件清理失败：$directory');
      }
    }
  }
  return warnings;
}
