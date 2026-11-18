part of 'app_database.dart';

class SyncDeviceState {
  const SyncDeviceState(this.deviceId, this.counter, this.generation,
      this.publishedCounter, this.lastSuccessAt);

  final String deviceId;
  final int counter;
  final int generation;
  final int publishedCounter;
  final DateTime? lastSuccessAt;
}

class SyncPendingPublication {
  const SyncPendingPublication(this.generation, this.counter, this.bytes);

  final int generation;
  final int counter;
  final String bytes;
}

extension SyncDatabase on AppDatabase {
  Future<void> _createSyncTables() async {
    await customStatement('CREATE TABLE IF NOT EXISTS sync_device ('
        'id INTEGER PRIMARY KEY CHECK(id=1), device_id TEXT NOT NULL, '
        'counter INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0, '
        'published_counter INTEGER NOT NULL DEFAULT 0, imported INTEGER NOT NULL DEFAULT 0, '
        'last_success_at TEXT)');
    await customStatement('CREATE TABLE IF NOT EXISTS sync_records ('
        'kind TEXT NOT NULL, media_key TEXT NOT NULL, record TEXT NOT NULL, '
        'PRIMARY KEY(kind,media_key))');
    await customStatement('CREATE TABLE IF NOT EXISTS sync_pending ('
        'id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL, '
        'counter INTEGER NOT NULL, bytes TEXT NOT NULL)');
  }

  Future<SyncDeviceState> getSyncDevice() async {
    final random = Random.secure();
    final id = List.generate(24, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    await customStatement('INSERT OR IGNORE INTO sync_device(id,device_id) VALUES(1,?)', [id]);
    final row = await customSelect('SELECT * FROM sync_device WHERE id=1').getSingle();
    return SyncDeviceState(row.read<String>('device_id'), row.read<int>('counter'),
        row.read<int>('generation'), row.read<int>('published_counter'),
        DateTime.tryParse(row.readNullable<String>('last_success_at') ?? ''));
  }

  Future<List<SyncRecord>> readSyncRecords() async {
    final rows = await customSelect('SELECT record FROM sync_records ORDER BY kind,media_key').get();
    return rows.map((r) => SyncRecord.fromJson(jsonDecode(r.read<String>('record')))).toList();
  }

  Future<void> _storeSyncRecord(SyncRecord record) => customStatement(
      'INSERT OR REPLACE INTO sync_records(kind,media_key,record) VALUES(?,?,?)',
      [record.kind.name, record.key, jsonEncode(record.toJson())]);

  Future<SyncVersion> _nextSyncVersion() async {
    final state = await getSyncDevice();
    if (state.counter >= maxSafeInteger) throw const SyncProtocolException('Sync counter exhausted');
    await customStatement('UPDATE sync_device SET counter=? WHERE id=1', [state.counter + 1]);
    return SyncVersion(state.counter + 1, state.deviceId);
  }

  Future<void> _recordLocalFavorite(MediaIdentity identity, bool deleted) async {
    final record = SyncRecord.favorite(mediaType: identity.mediaType,
        pluginId: identity.pluginId, mediaId: identity.mediaId,
        version: await _nextSyncVersion(), updatedAt: DateTime.now().toUtc().toIso8601String(),
        isDeleted: deleted);
    await _storeSyncRecord(record);
  }

  Future<void> _recordLocalProgress(LocalTrackingData row) async {
    final position = row.position;
    final record = SyncRecord.progress(mediaType: row.mediaType, pluginId: row.pluginId,
        mediaId: row.mediaId, version: await _nextSyncVersion(),
        updatedAt: row.updatedAt.toUtc().toIso8601String(), chapterId: row.chapterId ?? '',
        chapterNo: row.chapterNo, progress: row.progress,
        position: row.mediaType == 'novel' ? row.progress
            : position == null ? null : row.mediaType == 'manga' ? position : position / 1000,
        status: row.status);
    await _storeSyncRecord(record);
  }

  Future<void> _importSyncLegacy() async {
    await getSyncDevice();
    final state = await customSelect('SELECT imported FROM sync_device WHERE id=1').getSingle();
    if (state.read<int>('imported') != 0) return;
    for (final row in await getAllFavorites()) {
      await _recordLocalFavorite(MediaIdentity(pluginId: row.pluginId,
          mediaType: row.mediaType, mediaId: row.mediaId), false);
    }
    for (final row in await getAllTracking()) {
      await _recordLocalProgress(row);
    }
    await customStatement('UPDATE sync_device SET imported=1 WHERE id=1');
  }

  Future<SyncPendingPublication?> getSyncPending() async {
    final row = await customSelect('SELECT * FROM sync_pending WHERE id=1').getSingleOrNull();
    return row == null ? null : SyncPendingPublication(row.read<int>('generation'),
        row.read<int>('counter'), row.read<String>('bytes'));
  }

  Future<void> _applySyncRecord(SyncRecord record) async {
    final identity = MediaIdentity(pluginId: record.pluginId,
        mediaType: record.mediaType, mediaId: record.mediaId);
    final time = DateTime.tryParse(record.updatedAt) ?? DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);
    if (record.kind == SyncRecordKind.favorite) {
      if (record.isDeleted!) {
        await (delete(localFavorites)..where((f) => f.pluginId.equals(record.pluginId) &
            f.mediaType.equals(record.mediaType) & f.mediaId.equals(record.mediaId))).go();
      } else {
        await into(localFavorites).insertOnConflictUpdate(LocalFavoritesCompanion(
          id: Value(identity.key), pluginId: Value(record.pluginId),
          mediaType: Value(record.mediaType), mediaId: Value(record.mediaId), createdAt: Value(time),
        ));
      }
      return;
    }
    final old = await getTracking(identity);
    final sameChapter = old?.chapterId == record.chapterId;
    final novel = record.mediaType == 'novel';
    final position = record.position;
    await into(localTracking).insertOnConflictUpdate(LocalTrackingCompanion(
      id: Value(old?.id ?? identity.key), pluginId: Value(record.pluginId),
      mediaType: Value(record.mediaType), mediaId: Value(record.mediaId),
      chapterId: Value(record.chapterId!.isEmpty ? null : record.chapterId),
      chapterTitle: Value(sameChapter ? old?.chapterTitle : null),
      chapterNo: Value(record.chapterNo!),
      progress: Value((novel && position != null ? position : record.progress!).toDouble()),
      position: Value(novel || position == null ? null
          : record.mediaType == 'manga' ? position.toInt() : (position * 1000).round()),
      status: Value(record.status!), updatedAt: Value(time),
    ));
  }

  Future<SyncPendingPublication> prepareSyncPublication(List<SyncRecord> remote) {
    return transaction(() async {
      await _importSyncLegacy();
      if (await getSyncPending() != null) {
        throw const SyncProtocolException('Pending publication must be completed first');
      }
      final state = await getSyncDevice();
      final local = await readSyncRecords();
      final records = mergeRecords([local, remote]);
      var counter = state.counter;
      for (final record in records) {
        counter = max(counter, record.version.counter);
      }
      if (state.generation >= maxSafeInteger) throw const SyncProtocolException('Sync generation exhausted');
      final generation = state.generation + 1;
      final bytes = encodeSnapshot(SyncSnapshot(deviceId: state.deviceId,
          generation: generation, records: records));
      parseSnapshot(bytes);
      for (final record in records) {
        await _storeSyncRecord(record);
        await _applySyncRecord(record);
      }
      await customStatement('UPDATE sync_device SET counter=?,generation=? WHERE id=1', [counter, generation]);
      await customStatement('INSERT INTO sync_pending(id,generation,counter,bytes) VALUES(1,?,?,?)',
          [generation, counter, bytes]);
      return SyncPendingPublication(generation, counter, bytes);
    });
  }

  Future<void> completeSyncPublication(SyncPendingPublication pending) {
    return transaction(() async {
      final saved = await getSyncPending();
      if (saved == null || saved.bytes != pending.bytes || saved.generation != pending.generation ||
          saved.counter != pending.counter) {
        throw const SyncProtocolException('Publication mismatch');
      }
      await customStatement('UPDATE sync_device SET published_counter=?,last_success_at=? WHERE id=1',
          [pending.counter, DateTime.now().toUtc().toIso8601String()]);
      await customStatement('DELETE FROM sync_pending WHERE id=1');
    });
  }
}
