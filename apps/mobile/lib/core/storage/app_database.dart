import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../identity/media_identity.dart';
import '../sync/sync_protocol.dart';

part 'app_database.g.dart';
part 'sync_database.dart';

@DataClassName('LocalTrackingData')
class LocalTracking extends Table {
  TextColumn get id => text()();
  TextColumn get pluginId => text()();
  TextColumn get mediaType => text()();
  TextColumn get mediaId => text()();
  IntColumn get chapterNo => integer().withDefault(const Constant(0))();
  TextColumn get chapterId => text().nullable()();
  TextColumn get chapterTitle => text().nullable()();
  RealColumn get progress => real().withDefault(const Constant(0.0))();
  IntColumn get position => integer().nullable()();
  TextColumn get status => text().withDefault(const Constant('watching'))();
  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {pluginId, mediaType, mediaId};
}

@DataClassName('LocalFavorite')
class LocalFavorites extends Table {
  TextColumn get id => text()();
  TextColumn get pluginId => text()();
  TextColumn get mediaType => text()();
  TextColumn get mediaId => text()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {pluginId, mediaType, mediaId};
}

@DriftDatabase(tables: [LocalTracking, LocalFavorites])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  AppDatabase.forTesting(super.executor);

  @override
  int get schemaVersion => 3;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (m) async {
          await m.createAll();
          await _createSyncTables();
        },
        onUpgrade: (m, from, to) async {
          if (from < 2) {
            await customStatement(_dedupeTrackingSql);
            await customStatement(_dedupeFavoritesSql);
            await m.alterTable(TableMigration(
              localTracking,
              columnTransformer: {
                localTracking.chapterTitle: const CustomExpression<String>('NULL'),
                localTracking.position: const CustomExpression<int>('NULL'),
              },
            ));
            await m.alterTable(TableMigration(localFavorites));
          }
          if (from < 3) await _createSyncTables();
        },
      );

  Future<List<LocalTrackingData>> getAllTracking() => select(localTracking).get();

  Future<LocalTrackingData?> getTracking(MediaIdentity identity) {
    return (select(localTracking)
          ..where((t) =>
              t.pluginId.equals(identity.pluginId) &
              t.mediaType.equals(identity.mediaType) &
              t.mediaId.equals(identity.mediaId)))
        .getSingleOrNull();
  }

  Future<LocalTrackingData?> getLatestTracking() {
    return (select(localTracking)
          ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)])
          ..limit(1))
        .getSingleOrNull();
  }

  Stream<LocalTrackingData?> watchTracking(MediaIdentity identity) {
    return (select(localTracking)
          ..where((t) =>
              t.pluginId.equals(identity.pluginId) &
              t.mediaType.equals(identity.mediaType) &
              t.mediaId.equals(identity.mediaId)))
        .watchSingleOrNull();
  }

  Future<int> saveTracking(LocalTrackingCompanion entity) {
    return transaction(() async {
      await _importSyncLegacy();
      final result = await into(localTracking).insertOnConflictUpdate(entity);
      final identity = MediaIdentity(pluginId: entity.pluginId.value,
          mediaType: entity.mediaType.value, mediaId: entity.mediaId.value);
      await _recordLocalProgress((await getTracking(identity))!);
      return result;
    });
  }

  Future<int> deleteTracking(MediaIdentity identity) {
    return (delete(localTracking)
          ..where((t) =>
              t.pluginId.equals(identity.pluginId) &
              t.mediaType.equals(identity.mediaType) &
              t.mediaId.equals(identity.mediaId)))
        .go();
  }

  Future<List<LocalFavorite>> getAllFavorites() => select(localFavorites).get();

  Future<LocalFavorite?> getFavorite(MediaIdentity identity) {
    return (select(localFavorites)
          ..where((f) =>
              f.pluginId.equals(identity.pluginId) &
              f.mediaType.equals(identity.mediaType) &
              f.mediaId.equals(identity.mediaId)))
        .getSingleOrNull();
  }

  Stream<LocalFavorite?> watchFavorite(MediaIdentity identity) {
    return (select(localFavorites)
          ..where((f) =>
              f.pluginId.equals(identity.pluginId) &
              f.mediaType.equals(identity.mediaType) &
              f.mediaId.equals(identity.mediaId)))
        .watchSingleOrNull();
  }

  Future<int> saveFavorite(LocalFavoritesCompanion entity) {
    return transaction(() async {
      await _importSyncLegacy();
      final result = await into(localFavorites).insertOnConflictUpdate(entity);
      await _recordLocalFavorite(MediaIdentity(pluginId: entity.pluginId.value,
          mediaType: entity.mediaType.value, mediaId: entity.mediaId.value), false);
      return result;
    });
  }

  Future<int> deleteFavorite(MediaIdentity identity) {
    return transaction(() async {
      await _importSyncLegacy();
      final result = await (delete(localFavorites)
          ..where((f) =>
              f.pluginId.equals(identity.pluginId) &
              f.mediaType.equals(identity.mediaType) &
              f.mediaId.equals(identity.mediaId)))
        .go();
      await _recordLocalFavorite(identity, true);
      return result;
    });
  }
}

const String _dedupeTrackingSql = '''
DELETE FROM local_tracking WHERE EXISTS (
  SELECT 1 FROM local_tracking AS newer
  WHERE newer.plugin_id = local_tracking.plugin_id
    AND newer.media_type = local_tracking.media_type
    AND newer.media_id = local_tracking.media_id
    AND (newer.updated_at > local_tracking.updated_at
      OR (newer.updated_at = local_tracking.updated_at
        AND newer.rowid > local_tracking.rowid))
)''';

const String _dedupeFavoritesSql = '''
DELETE FROM local_favorites WHERE EXISTS (
  SELECT 1 FROM local_favorites AS newer
  WHERE newer.plugin_id = local_favorites.plugin_id
    AND newer.media_type = local_favorites.media_type
    AND newer.media_id = local_favorites.media_id
    AND newer.rowid > local_favorites.rowid
)''';

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dbFolder = await getApplicationDocumentsDirectory();
    final file = File(p.join(dbFolder.path, 'titanhub.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
