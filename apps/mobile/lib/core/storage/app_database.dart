import 'dart:io';
import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

part 'app_database.g.dart';

// Local Tracking Table Definition
class LocalTracking extends Table {
  TextColumn get id => text()(); // UUID generated or matching server tracking id
  TextColumn get mediaId => text()(); // unique item identifier (e.g. manga-101)
  TextColumn get pluginId => text()();
  TextColumn get mediaType => text()(); // 'anime', 'manga', 'novel', 'movie'
  IntColumn get chapterNo => integer().withDefault(const Constant(0))();
  TextColumn get chapterId => text().nullable()();
  RealColumn get progress => real().withDefault(const Constant(0.0))(); // 0.0 to 1.0
  TextColumn get status => text().withDefault(const Constant('watching'))(); // 'watching', 'completed', 'dropped'
  DateTimeColumn get updatedAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {id};
}

// Local Bookmarks Table Definition
class LocalFavorites extends Table {
  TextColumn get id => text()(); // UUID or matching local id
  TextColumn get mediaId => text()();
  TextColumn get pluginId => text()();
  TextColumn get mediaType => text()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {id};
}

@DriftDatabase(tables: [LocalTracking, LocalFavorites])
class AppDatabase extends _$AppDatabase {
  AppDatabase() : super(_openConnection());

  @override
  int get schemaVersion => 1;

  // Tracking DAO Methods
  Future<List<LocalTrackingData>> getAllTracking() => select(localTracking).get();
  Future<LocalTrackingData?> getTracking(String mediaId) {
    return (select(localTracking)..where((t) => t.mediaId.equals(mediaId))).getSingleOrNull();
  }
  Future<int> saveTracking(LocalTrackingCompanion entity) {
    return into(localTracking).insertOnConflictUpdate(entity);
  }
  Future<int> deleteTracking(String mediaId) {
    return (delete(localTracking)..where((t) => t.mediaId.equals(mediaId))).go();
  }

  // Favorites DAO Methods
  Future<List<LocalFavorite>> getAllFavorites() => select(localFavorites).get();
  Future<LocalFavorite?> getFavorite(String mediaId) {
    return (select(localFavorites)..where((f) => f.mediaId.equals(mediaId))).getSingleOrNull();
  }
  Future<int> saveFavorite(LocalFavoriteCompanion entity) {
    return into(localFavorites).insertOnConflictUpdate(entity);
  }
  Future<int> deleteFavorite(String mediaId) {
    return (delete(localFavorites)..where((f) => f.mediaId.equals(mediaId))).go();
  }
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dbFolder = await getApplicationDocumentsDirectory();
    final file = File(p.join(dbFolder.path, 'titanhub.sqlite'));
    return NativeDatabase.createInBackground(file);
  });
}
