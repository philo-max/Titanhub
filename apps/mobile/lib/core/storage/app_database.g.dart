// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  
  // Minimal representation for compiler resolution
  late final $LocalTrackingTable localTracking = $LocalTrackingTable(this);
  late final $LocalFavoritesTable localFavorites = $LocalFavoritesTable(this);
}

class $LocalTrackingTable extends Table with TableInfo {
  final GeneratedDatabase _db;
  final String? _alias;
  $LocalTrackingTable(this._db, [this._alias]);
  
  @override
  List<GeneratedColumn> get $columns => [];
  @override
  String get actualTableName => 'local_tracking';
  @override
  $LocalTrackingTable createAlias(String alias) => $LocalTrackingTable(_db, alias);
}

class $LocalFavoritesTable extends Table with TableInfo {
  final GeneratedDatabase _db;
  final String? _alias;
  $LocalFavoritesTable(this._db, [this._alias]);
  
  @override
  List<GeneratedColumn> get $columns => [];
  @override
  String get actualTableName => 'local_favorites';
  @override
  $LocalFavoritesTable createAlias(String alias) => $LocalFavoritesTable(_db, alias);
}
