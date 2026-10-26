import 'dart:convert';

const int syncSchemaVersion = 1;
const int maxSnapshotBytes = 8 * 1024 * 1024;
const int maxRecords = 20000;
const int maxSafeInteger = 9007199254740991;
const int maxStringLength = 8192;

class SyncProtocolException implements Exception {
  const SyncProtocolException(this.message);

  final String message;

  @override
  String toString() => 'SyncProtocolException: $message';
}

enum SyncRecordKind { favorite, progress }

class SyncVersion {
  factory SyncVersion(int counter, String deviceId) {
    final id = _string(deviceId);
    if (id.isEmpty) throw const SyncProtocolException('Invalid media key/device');
    return SyncVersion._(_integer(counter), id);
  }

  factory SyncVersion.fromJson(Object? value) {
    if (value is! Map) throw const SyncProtocolException('Invalid record kind/version');
    return SyncVersion._(_integer(value['counter']), _string(value['deviceId']));
  }

  const SyncVersion._(this.counter, this.deviceId);

  final int counter;
  final String deviceId;

  Map<String, Object?> toJson() => {'counter': counter, 'deviceId': deviceId};
}

class SyncRecord {
  const SyncRecord._({
    required this.kind,
    required this.key,
    required this.mediaType,
    required this.pluginId,
    required this.mediaId,
    required this.version,
    required this.updatedAt,
    this.isDeleted,
    this.chapterId,
    this.chapterNo,
    this.progress,
    this.position,
    this.status,
  });

  factory SyncRecord.favorite({
    required String mediaType,
    required String pluginId,
    required String mediaId,
    required SyncVersion version,
    required String updatedAt,
    required bool isDeleted,
  }) =>
      SyncRecord.fromJson({
        'kind': SyncRecordKind.favorite.name,
        'key': mediaKey(mediaType, pluginId, mediaId),
        'mediaType': mediaType,
        'pluginId': pluginId,
        'mediaId': mediaId,
        'version': version.toJson(),
        'updatedAt': updatedAt,
        'isDeleted': isDeleted,
      });

  factory SyncRecord.progress({
    required String mediaType,
    required String pluginId,
    required String mediaId,
    required SyncVersion version,
    required String updatedAt,
    required String chapterId,
    required int chapterNo,
    required num progress,
    required num? position,
    required String status,
  }) =>
      SyncRecord.fromJson({
        'kind': SyncRecordKind.progress.name,
        'key': mediaKey(mediaType, pluginId, mediaId),
        'mediaType': mediaType,
        'pluginId': pluginId,
        'mediaId': mediaId,
        'version': version.toJson(),
        'updatedAt': updatedAt,
        'chapterId': chapterId,
        'chapterNo': chapterNo,
        'progress': progress,
        'position': position,
        'status': status,
      });

  factory SyncRecord.fromJson(Object? value) {
    if (value is! Map) throw const SyncProtocolException('Invalid record');
    final rawKind = value['kind'];
    final rawVersion = value['version'];
    final kind = rawKind == 'favorite'
        ? SyncRecordKind.favorite
        : rawKind == 'progress'
            ? SyncRecordKind.progress
            : null;
    if (rawVersion is! Map || kind == null) throw const SyncProtocolException('Invalid record kind/version');
    final key = _string(value['key']);
    final mediaType = _string(value['mediaType']);
    final pluginId = _string(value['pluginId']);
    final mediaId = _string(value['mediaId']);
    final version = SyncVersion.fromJson(rawVersion);
    final updatedAt = _string(value['updatedAt']);
    if (version.deviceId.isEmpty || key != mediaKey(mediaType, pluginId, mediaId)) {
      throw const SyncProtocolException('Invalid media key/device');
    }
    if (kind == SyncRecordKind.favorite) {
      final isDeleted = value['isDeleted'];
      if (isDeleted is! bool) throw const SyncProtocolException('Invalid tombstone');
      return SyncRecord._(
        kind: kind,
        key: key,
        mediaType: mediaType,
        pluginId: pluginId,
        mediaId: mediaId,
        version: version,
        updatedAt: updatedAt,
        isDeleted: isDeleted,
      );
    }
    final chapterId = _string(value['chapterId']);
    final chapterNo = _integer(value['chapterNo']);
    final progress = _number(value['progress'], 1);
    if (!value.containsKey('position')) throw const SyncProtocolException('Invalid number');
    final rawPosition = value['position'];
    final position = rawPosition == null ? null : _number(rawPosition);
    if (mediaType == 'novel' && position != null) _number(position, 1);
    if (mediaType == 'manga' && position != null) _integer(position);
    final status = _string(value['status']);
    return SyncRecord._(
      kind: kind,
      key: key,
      mediaType: mediaType,
      pluginId: pluginId,
      mediaId: mediaId,
      version: version,
      updatedAt: updatedAt,
      chapterId: chapterId,
      chapterNo: chapterNo,
      progress: progress,
      position: position,
      status: status,
    );
  }

  final SyncRecordKind kind;
  final String key;
  final String mediaType;
  final String pluginId;
  final String mediaId;
  final SyncVersion version;
  final String updatedAt;
  final bool? isDeleted;
  final String? chapterId;
  final int? chapterNo;
  final num? progress;
  final num? position;
  final String? status;

  Map<String, Object?> toJson() => {
        'kind': kind.name,
        'key': key,
        'mediaType': mediaType,
        'pluginId': pluginId,
        'mediaId': mediaId,
        'version': version.toJson(),
        'updatedAt': updatedAt,
        if (kind == SyncRecordKind.favorite) 'isDeleted': isDeleted,
        if (kind == SyncRecordKind.progress) ...{
          'chapterId': chapterId,
          'chapterNo': chapterNo,
          'progress': progress,
          'position': position,
          'status': status,
        },
      };
}

class SyncSnapshot {
  factory SyncSnapshot({required String deviceId, required int generation, required List<SyncRecord> records}) {
    final id = _string(deviceId);
    if (id.isEmpty) throw const SyncProtocolException('Invalid snapshot device');
    if (records.length > maxRecords) throw const SyncProtocolException('Invalid snapshot schema');
    return SyncSnapshot._(id, _integer(generation), mergeRecords([records]));
  }

  const SyncSnapshot._(this.deviceId, this.generation, this.records);

  final String deviceId;
  final int generation;
  final List<SyncRecord> records;

  Map<String, Object?> toJson() => {
        'schemaVersion': syncSchemaVersion,
        'deviceId': deviceId,
        'generation': generation,
        'records': [for (final record in records) record.toJson()],
      };
}

String mediaKey(String mediaType, String pluginId, String mediaId) => _encode([mediaType, pluginId, mediaId]);

int compareVersions(SyncVersion a, SyncVersion b) => a.counter == b.counter
    ? _compareBytes(_utf8Bytes(a.deviceId), _utf8Bytes(b.deviceId))
    : a.counter.compareTo(b.counter);

List<SyncRecord> mergeRecords(Iterable<Iterable<SyncRecord>> groups) {
  final merged = <String, SyncRecord>{};
  for (final group in groups) {
    for (final record in group) {
      final identity = _encode([record.kind.name, record.key]);
      final old = merged[identity];
      final comparison = old == null ? 1 : compareVersions(record.version, old.version);
      if (comparison == 0 && _encode(record.toJson()) != _encode(old!.toJson())) {
        throw const SyncProtocolException('Conflicting equal versions');
      }
      if (comparison > 0) merged[identity] = record;
    }
  }
  if (merged.length > maxRecords) throw const SyncProtocolException('Too many records');
  final identities = merged.keys.toList()..sort();
  return [for (final identity in identities) merged[identity]!];
}

SyncSnapshot parseSnapshot(String text) {
  if (_utf8Length(text) > maxSnapshotBytes) throw const SyncProtocolException('Snapshot too large');
  Object? value;
  try {
    value = jsonDecode(text);
  } on FormatException {
    throw const SyncProtocolException('Invalid snapshot json');
  }
  if (value is! Map) throw const SyncProtocolException('Invalid snapshot schema');
  final schema = value['schemaVersion'];
  final records = value['records'];
  if (schema is! num || schema != syncSchemaVersion || records is! List || records.length > maxRecords) {
    throw const SyncProtocolException('Invalid snapshot schema');
  }
  final deviceId = _string(value['deviceId']);
  if (deviceId.isEmpty) throw const SyncProtocolException('Invalid snapshot device');
  final generation = _integer(value['generation']);
  return SyncSnapshot._(deviceId, generation, mergeRecords([records.map(SyncRecord.fromJson)]));
}

String encodeSnapshot(SyncSnapshot snapshot) => _encode(snapshot.toJson());

String encodeRecords(Iterable<SyncRecord> records) => _encode([for (final record in records) record.toJson()]);

String _string(Object? value) {
  if (value is! String || value.length > maxStringLength) throw const SyncProtocolException('Invalid string');
  return value;
}

int _integer(Object? value) {
  if (value is int && value >= 0 && value <= maxSafeInteger) return value;
  if (value is double && value.isFinite && value == value.truncateToDouble() && value >= 0 && value <= maxSafeInteger) {
    return value.toInt();
  }
  throw const SyncProtocolException('Invalid integer');
}

num _number(Object? value, [num max = maxSafeInteger]) {
  if (value is! num || !value.isFinite || value < 0 || value > max) throw const SyncProtocolException('Invalid number');
  return value;
}

String _encode(Object? value) => (StringBuffer().._writeJson(value)).toString();

extension on StringBuffer {
  void _writeJson(Object? value) {
    if (value == null || value is bool) {
      write(value);
    } else if (value is num) {
      write(value.abs() <= maxSafeInteger && value == value.truncateToDouble() ? value.toInt() : value);
    } else if (value is String) {
      _writeJsonString(value);
    } else if (value is List) {
      write('[');
      for (var i = 0; i < value.length; i++) {
        if (i > 0) write(',');
        _writeJson(value[i]);
      }
      write(']');
    } else if (value is Map) {
      write('{');
      var first = true;
      value.forEach((key, item) {
        if (!first) write(',');
        first = false;
        _writeJsonString(key as String);
        write(':');
        _writeJson(item);
      });
      write('}');
    } else {
      throw SyncProtocolException('Unsupported json value: ${value.runtimeType}');
    }
  }

  void _writeJsonString(String value) {
    write('"');
    for (var i = 0; i < value.length; i++) {
      final unit = value.codeUnitAt(i);
      if (unit == 0x22) {
        write(r'\"');
      } else if (unit == 0x5c) {
        write(r'\\');
      } else if (unit == 0x08) {
        write(r'\b');
      } else if (unit == 0x0c) {
        write(r'\f');
      } else if (unit == 0x0a) {
        write(r'\n');
      } else if (unit == 0x0d) {
        write(r'\r');
      } else if (unit == 0x09) {
        write(r'\t');
      } else if (unit < 0x20) {
        _writeUnicodeEscape(unit);
      } else if (_isHighSurrogate(unit) && i + 1 < value.length && _isLowSurrogate(value.codeUnitAt(i + 1))) {
        writeCharCode(unit);
        writeCharCode(value.codeUnitAt(++i));
      } else if (_isHighSurrogate(unit) || _isLowSurrogate(unit)) {
        _writeUnicodeEscape(unit);
      } else {
        writeCharCode(unit);
      }
    }
    write('"');
  }

  void _writeUnicodeEscape(int unit) => write('\\u${unit.toRadixString(16).padLeft(4, '0')}');
}

bool _isHighSurrogate(int unit) => unit >= 0xd800 && unit <= 0xdbff;

bool _isLowSurrogate(int unit) => unit >= 0xdc00 && unit <= 0xdfff;

Iterable<int> _codePoints(String value) sync* {
  for (var i = 0; i < value.length; i++) {
    final unit = value.codeUnitAt(i);
    if (_isHighSurrogate(unit) && i + 1 < value.length && _isLowSurrogate(value.codeUnitAt(i + 1))) {
      yield 0x10000 + ((unit - 0xd800) << 10) + (value.codeUnitAt(++i) - 0xdc00);
    } else if (_isHighSurrogate(unit) || _isLowSurrogate(unit)) {
      yield 0xfffd;
    } else {
      yield unit;
    }
  }
}

int _utf8Width(int codePoint) => codePoint < 0x80
    ? 1
    : codePoint < 0x800
        ? 2
        : codePoint < 0x10000
            ? 3
            : 4;

int _utf8Length(String value) {
  var length = 0;
  for (final codePoint in _codePoints(value)) {
    length += _utf8Width(codePoint);
  }
  return length;
}

List<int> _utf8Bytes(String value) {
  final bytes = <int>[];
  for (final codePoint in _codePoints(value)) {
    final width = _utf8Width(codePoint);
    if (width == 1) {
      bytes.add(codePoint);
      continue;
    }
    const leads = [0, 0, 0xc0, 0xe0, 0xf0];
    bytes.add(leads[width] | (codePoint >> (6 * (width - 1))));
    for (var shift = 6 * (width - 2); shift >= 0; shift -= 6) {
      bytes.add(0x80 | ((codePoint >> shift) & 0x3f));
    }
  }
  return bytes;
}

int _compareBytes(List<int> a, List<int> b) {
  final length = a.length < b.length ? a.length : b.length;
  for (var i = 0; i < length; i++) {
    if (a[i] != b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length.compareTo(b.length);
}
