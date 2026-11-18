// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $LocalTrackingTable extends LocalTracking
    with TableInfo<$LocalTrackingTable, LocalTrackingData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalTrackingTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _pluginIdMeta =
      const VerificationMeta('pluginId');
  @override
  late final GeneratedColumn<String> pluginId = GeneratedColumn<String>(
      'plugin_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _mediaTypeMeta =
      const VerificationMeta('mediaType');
  @override
  late final GeneratedColumn<String> mediaType = GeneratedColumn<String>(
      'media_type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _mediaIdMeta =
      const VerificationMeta('mediaId');
  @override
  late final GeneratedColumn<String> mediaId = GeneratedColumn<String>(
      'media_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _chapterNoMeta =
      const VerificationMeta('chapterNo');
  @override
  late final GeneratedColumn<int> chapterNo = GeneratedColumn<int>(
      'chapter_no', aliasedName, false,
      type: DriftSqlType.int,
      requiredDuringInsert: false,
      defaultValue: const Constant(0));
  static const VerificationMeta _chapterIdMeta =
      const VerificationMeta('chapterId');
  @override
  late final GeneratedColumn<String> chapterId = GeneratedColumn<String>(
      'chapter_id', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _chapterTitleMeta =
      const VerificationMeta('chapterTitle');
  @override
  late final GeneratedColumn<String> chapterTitle = GeneratedColumn<String>(
      'chapter_title', aliasedName, true,
      type: DriftSqlType.string, requiredDuringInsert: false);
  static const VerificationMeta _progressMeta =
      const VerificationMeta('progress');
  @override
  late final GeneratedColumn<double> progress = GeneratedColumn<double>(
      'progress', aliasedName, false,
      type: DriftSqlType.double,
      requiredDuringInsert: false,
      defaultValue: const Constant(0.0));
  static const VerificationMeta _positionMeta =
      const VerificationMeta('position');
  @override
  late final GeneratedColumn<int> position = GeneratedColumn<int>(
      'position', aliasedName, true,
      type: DriftSqlType.int, requiredDuringInsert: false);
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
      'status', aliasedName, false,
      type: DriftSqlType.string,
      requiredDuringInsert: false,
      defaultValue: const Constant('watching'));
  static const VerificationMeta _updatedAtMeta =
      const VerificationMeta('updatedAt');
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
      'updated_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns => [
        id,
        pluginId,
        mediaType,
        mediaId,
        chapterNo,
        chapterId,
        chapterTitle,
        progress,
        position,
        status,
        updatedAt
      ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_tracking';
  @override
  VerificationContext validateIntegrity(Insertable<LocalTrackingData> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('plugin_id')) {
      context.handle(_pluginIdMeta,
          pluginId.isAcceptableOrUnknown(data['plugin_id']!, _pluginIdMeta));
    } else if (isInserting) {
      context.missing(_pluginIdMeta);
    }
    if (data.containsKey('media_type')) {
      context.handle(_mediaTypeMeta,
          mediaType.isAcceptableOrUnknown(data['media_type']!, _mediaTypeMeta));
    } else if (isInserting) {
      context.missing(_mediaTypeMeta);
    }
    if (data.containsKey('media_id')) {
      context.handle(_mediaIdMeta,
          mediaId.isAcceptableOrUnknown(data['media_id']!, _mediaIdMeta));
    } else if (isInserting) {
      context.missing(_mediaIdMeta);
    }
    if (data.containsKey('chapter_no')) {
      context.handle(_chapterNoMeta,
          chapterNo.isAcceptableOrUnknown(data['chapter_no']!, _chapterNoMeta));
    }
    if (data.containsKey('chapter_id')) {
      context.handle(_chapterIdMeta,
          chapterId.isAcceptableOrUnknown(data['chapter_id']!, _chapterIdMeta));
    }
    if (data.containsKey('chapter_title')) {
      context.handle(
          _chapterTitleMeta,
          chapterTitle.isAcceptableOrUnknown(
              data['chapter_title']!, _chapterTitleMeta));
    }
    if (data.containsKey('progress')) {
      context.handle(_progressMeta,
          progress.isAcceptableOrUnknown(data['progress']!, _progressMeta));
    }
    if (data.containsKey('position')) {
      context.handle(_positionMeta,
          position.isAcceptableOrUnknown(data['position']!, _positionMeta));
    }
    if (data.containsKey('status')) {
      context.handle(_statusMeta,
          status.isAcceptableOrUnknown(data['status']!, _statusMeta));
    }
    if (data.containsKey('updated_at')) {
      context.handle(_updatedAtMeta,
          updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {pluginId, mediaType, mediaId};
  @override
  LocalTrackingData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalTrackingData(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      pluginId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}plugin_id'])!,
      mediaType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}media_type'])!,
      mediaId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}media_id'])!,
      chapterNo: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}chapter_no'])!,
      chapterId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}chapter_id']),
      chapterTitle: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}chapter_title']),
      progress: attachedDatabase.typeMapping
          .read(DriftSqlType.double, data['${effectivePrefix}progress'])!,
      position: attachedDatabase.typeMapping
          .read(DriftSqlType.int, data['${effectivePrefix}position']),
      status: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}status'])!,
      updatedAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}updated_at'])!,
    );
  }

  @override
  $LocalTrackingTable createAlias(String alias) {
    return $LocalTrackingTable(attachedDatabase, alias);
  }
}

class LocalTrackingData extends DataClass
    implements Insertable<LocalTrackingData> {
  final String id;
  final String pluginId;
  final String mediaType;
  final String mediaId;
  final int chapterNo;
  final String? chapterId;
  final String? chapterTitle;
  final double progress;
  final int? position;
  final String status;
  final DateTime updatedAt;
  const LocalTrackingData(
      {required this.id,
      required this.pluginId,
      required this.mediaType,
      required this.mediaId,
      required this.chapterNo,
      this.chapterId,
      this.chapterTitle,
      required this.progress,
      this.position,
      required this.status,
      required this.updatedAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['plugin_id'] = Variable<String>(pluginId);
    map['media_type'] = Variable<String>(mediaType);
    map['media_id'] = Variable<String>(mediaId);
    map['chapter_no'] = Variable<int>(chapterNo);
    if (!nullToAbsent || chapterId != null) {
      map['chapter_id'] = Variable<String>(chapterId);
    }
    if (!nullToAbsent || chapterTitle != null) {
      map['chapter_title'] = Variable<String>(chapterTitle);
    }
    map['progress'] = Variable<double>(progress);
    if (!nullToAbsent || position != null) {
      map['position'] = Variable<int>(position);
    }
    map['status'] = Variable<String>(status);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  LocalTrackingCompanion toCompanion(bool nullToAbsent) {
    return LocalTrackingCompanion(
      id: Value(id),
      pluginId: Value(pluginId),
      mediaType: Value(mediaType),
      mediaId: Value(mediaId),
      chapterNo: Value(chapterNo),
      chapterId: chapterId == null && nullToAbsent
          ? const Value.absent()
          : Value(chapterId),
      chapterTitle: chapterTitle == null && nullToAbsent
          ? const Value.absent()
          : Value(chapterTitle),
      progress: Value(progress),
      position: position == null && nullToAbsent
          ? const Value.absent()
          : Value(position),
      status: Value(status),
      updatedAt: Value(updatedAt),
    );
  }

  factory LocalTrackingData.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalTrackingData(
      id: serializer.fromJson<String>(json['id']),
      pluginId: serializer.fromJson<String>(json['pluginId']),
      mediaType: serializer.fromJson<String>(json['mediaType']),
      mediaId: serializer.fromJson<String>(json['mediaId']),
      chapterNo: serializer.fromJson<int>(json['chapterNo']),
      chapterId: serializer.fromJson<String?>(json['chapterId']),
      chapterTitle: serializer.fromJson<String?>(json['chapterTitle']),
      progress: serializer.fromJson<double>(json['progress']),
      position: serializer.fromJson<int?>(json['position']),
      status: serializer.fromJson<String>(json['status']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'pluginId': serializer.toJson<String>(pluginId),
      'mediaType': serializer.toJson<String>(mediaType),
      'mediaId': serializer.toJson<String>(mediaId),
      'chapterNo': serializer.toJson<int>(chapterNo),
      'chapterId': serializer.toJson<String?>(chapterId),
      'chapterTitle': serializer.toJson<String?>(chapterTitle),
      'progress': serializer.toJson<double>(progress),
      'position': serializer.toJson<int?>(position),
      'status': serializer.toJson<String>(status),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  LocalTrackingData copyWith(
          {String? id,
          String? pluginId,
          String? mediaType,
          String? mediaId,
          int? chapterNo,
          Value<String?> chapterId = const Value.absent(),
          Value<String?> chapterTitle = const Value.absent(),
          double? progress,
          Value<int?> position = const Value.absent(),
          String? status,
          DateTime? updatedAt}) =>
      LocalTrackingData(
        id: id ?? this.id,
        pluginId: pluginId ?? this.pluginId,
        mediaType: mediaType ?? this.mediaType,
        mediaId: mediaId ?? this.mediaId,
        chapterNo: chapterNo ?? this.chapterNo,
        chapterId: chapterId.present ? chapterId.value : this.chapterId,
        chapterTitle:
            chapterTitle.present ? chapterTitle.value : this.chapterTitle,
        progress: progress ?? this.progress,
        position: position.present ? position.value : this.position,
        status: status ?? this.status,
        updatedAt: updatedAt ?? this.updatedAt,
      );
  LocalTrackingData copyWithCompanion(LocalTrackingCompanion data) {
    return LocalTrackingData(
      id: data.id.present ? data.id.value : this.id,
      pluginId: data.pluginId.present ? data.pluginId.value : this.pluginId,
      mediaType: data.mediaType.present ? data.mediaType.value : this.mediaType,
      mediaId: data.mediaId.present ? data.mediaId.value : this.mediaId,
      chapterNo: data.chapterNo.present ? data.chapterNo.value : this.chapterNo,
      chapterId: data.chapterId.present ? data.chapterId.value : this.chapterId,
      chapterTitle: data.chapterTitle.present
          ? data.chapterTitle.value
          : this.chapterTitle,
      progress: data.progress.present ? data.progress.value : this.progress,
      position: data.position.present ? data.position.value : this.position,
      status: data.status.present ? data.status.value : this.status,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalTrackingData(')
          ..write('id: $id, ')
          ..write('pluginId: $pluginId, ')
          ..write('mediaType: $mediaType, ')
          ..write('mediaId: $mediaId, ')
          ..write('chapterNo: $chapterNo, ')
          ..write('chapterId: $chapterId, ')
          ..write('chapterTitle: $chapterTitle, ')
          ..write('progress: $progress, ')
          ..write('position: $position, ')
          ..write('status: $status, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, pluginId, mediaType, mediaId, chapterNo,
      chapterId, chapterTitle, progress, position, status, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalTrackingData &&
          other.id == this.id &&
          other.pluginId == this.pluginId &&
          other.mediaType == this.mediaType &&
          other.mediaId == this.mediaId &&
          other.chapterNo == this.chapterNo &&
          other.chapterId == this.chapterId &&
          other.chapterTitle == this.chapterTitle &&
          other.progress == this.progress &&
          other.position == this.position &&
          other.status == this.status &&
          other.updatedAt == this.updatedAt);
}

class LocalTrackingCompanion extends UpdateCompanion<LocalTrackingData> {
  final Value<String> id;
  final Value<String> pluginId;
  final Value<String> mediaType;
  final Value<String> mediaId;
  final Value<int> chapterNo;
  final Value<String?> chapterId;
  final Value<String?> chapterTitle;
  final Value<double> progress;
  final Value<int?> position;
  final Value<String> status;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const LocalTrackingCompanion({
    this.id = const Value.absent(),
    this.pluginId = const Value.absent(),
    this.mediaType = const Value.absent(),
    this.mediaId = const Value.absent(),
    this.chapterNo = const Value.absent(),
    this.chapterId = const Value.absent(),
    this.chapterTitle = const Value.absent(),
    this.progress = const Value.absent(),
    this.position = const Value.absent(),
    this.status = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalTrackingCompanion.insert({
    required String id,
    required String pluginId,
    required String mediaType,
    required String mediaId,
    this.chapterNo = const Value.absent(),
    this.chapterId = const Value.absent(),
    this.chapterTitle = const Value.absent(),
    this.progress = const Value.absent(),
    this.position = const Value.absent(),
    this.status = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        pluginId = Value(pluginId),
        mediaType = Value(mediaType),
        mediaId = Value(mediaId);
  static Insertable<LocalTrackingData> custom({
    Expression<String>? id,
    Expression<String>? pluginId,
    Expression<String>? mediaType,
    Expression<String>? mediaId,
    Expression<int>? chapterNo,
    Expression<String>? chapterId,
    Expression<String>? chapterTitle,
    Expression<double>? progress,
    Expression<int>? position,
    Expression<String>? status,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (pluginId != null) 'plugin_id': pluginId,
      if (mediaType != null) 'media_type': mediaType,
      if (mediaId != null) 'media_id': mediaId,
      if (chapterNo != null) 'chapter_no': chapterNo,
      if (chapterId != null) 'chapter_id': chapterId,
      if (chapterTitle != null) 'chapter_title': chapterTitle,
      if (progress != null) 'progress': progress,
      if (position != null) 'position': position,
      if (status != null) 'status': status,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalTrackingCompanion copyWith(
      {Value<String>? id,
      Value<String>? pluginId,
      Value<String>? mediaType,
      Value<String>? mediaId,
      Value<int>? chapterNo,
      Value<String?>? chapterId,
      Value<String?>? chapterTitle,
      Value<double>? progress,
      Value<int?>? position,
      Value<String>? status,
      Value<DateTime>? updatedAt,
      Value<int>? rowid}) {
    return LocalTrackingCompanion(
      id: id ?? this.id,
      pluginId: pluginId ?? this.pluginId,
      mediaType: mediaType ?? this.mediaType,
      mediaId: mediaId ?? this.mediaId,
      chapterNo: chapterNo ?? this.chapterNo,
      chapterId: chapterId ?? this.chapterId,
      chapterTitle: chapterTitle ?? this.chapterTitle,
      progress: progress ?? this.progress,
      position: position ?? this.position,
      status: status ?? this.status,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (pluginId.present) {
      map['plugin_id'] = Variable<String>(pluginId.value);
    }
    if (mediaType.present) {
      map['media_type'] = Variable<String>(mediaType.value);
    }
    if (mediaId.present) {
      map['media_id'] = Variable<String>(mediaId.value);
    }
    if (chapterNo.present) {
      map['chapter_no'] = Variable<int>(chapterNo.value);
    }
    if (chapterId.present) {
      map['chapter_id'] = Variable<String>(chapterId.value);
    }
    if (chapterTitle.present) {
      map['chapter_title'] = Variable<String>(chapterTitle.value);
    }
    if (progress.present) {
      map['progress'] = Variable<double>(progress.value);
    }
    if (position.present) {
      map['position'] = Variable<int>(position.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalTrackingCompanion(')
          ..write('id: $id, ')
          ..write('pluginId: $pluginId, ')
          ..write('mediaType: $mediaType, ')
          ..write('mediaId: $mediaId, ')
          ..write('chapterNo: $chapterNo, ')
          ..write('chapterId: $chapterId, ')
          ..write('chapterTitle: $chapterTitle, ')
          ..write('progress: $progress, ')
          ..write('position: $position, ')
          ..write('status: $status, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $LocalFavoritesTable extends LocalFavorites
    with TableInfo<$LocalFavoritesTable, LocalFavorite> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $LocalFavoritesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
      'id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _pluginIdMeta =
      const VerificationMeta('pluginId');
  @override
  late final GeneratedColumn<String> pluginId = GeneratedColumn<String>(
      'plugin_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _mediaTypeMeta =
      const VerificationMeta('mediaType');
  @override
  late final GeneratedColumn<String> mediaType = GeneratedColumn<String>(
      'media_type', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _mediaIdMeta =
      const VerificationMeta('mediaId');
  @override
  late final GeneratedColumn<String> mediaId = GeneratedColumn<String>(
      'media_id', aliasedName, false,
      type: DriftSqlType.string, requiredDuringInsert: true);
  static const VerificationMeta _createdAtMeta =
      const VerificationMeta('createdAt');
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
      'created_at', aliasedName, false,
      type: DriftSqlType.dateTime,
      requiredDuringInsert: false,
      defaultValue: currentDateAndTime);
  @override
  List<GeneratedColumn> get $columns =>
      [id, pluginId, mediaType, mediaId, createdAt];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'local_favorites';
  @override
  VerificationContext validateIntegrity(Insertable<LocalFavorite> instance,
      {bool isInserting = false}) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('plugin_id')) {
      context.handle(_pluginIdMeta,
          pluginId.isAcceptableOrUnknown(data['plugin_id']!, _pluginIdMeta));
    } else if (isInserting) {
      context.missing(_pluginIdMeta);
    }
    if (data.containsKey('media_type')) {
      context.handle(_mediaTypeMeta,
          mediaType.isAcceptableOrUnknown(data['media_type']!, _mediaTypeMeta));
    } else if (isInserting) {
      context.missing(_mediaTypeMeta);
    }
    if (data.containsKey('media_id')) {
      context.handle(_mediaIdMeta,
          mediaId.isAcceptableOrUnknown(data['media_id']!, _mediaIdMeta));
    } else if (isInserting) {
      context.missing(_mediaIdMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(_createdAtMeta,
          createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta));
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {pluginId, mediaType, mediaId};
  @override
  LocalFavorite map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return LocalFavorite(
      id: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}id'])!,
      pluginId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}plugin_id'])!,
      mediaType: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}media_type'])!,
      mediaId: attachedDatabase.typeMapping
          .read(DriftSqlType.string, data['${effectivePrefix}media_id'])!,
      createdAt: attachedDatabase.typeMapping
          .read(DriftSqlType.dateTime, data['${effectivePrefix}created_at'])!,
    );
  }

  @override
  $LocalFavoritesTable createAlias(String alias) {
    return $LocalFavoritesTable(attachedDatabase, alias);
  }
}

class LocalFavorite extends DataClass implements Insertable<LocalFavorite> {
  final String id;
  final String pluginId;
  final String mediaType;
  final String mediaId;
  final DateTime createdAt;
  const LocalFavorite(
      {required this.id,
      required this.pluginId,
      required this.mediaType,
      required this.mediaId,
      required this.createdAt});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['plugin_id'] = Variable<String>(pluginId);
    map['media_type'] = Variable<String>(mediaType);
    map['media_id'] = Variable<String>(mediaId);
    map['created_at'] = Variable<DateTime>(createdAt);
    return map;
  }

  LocalFavoritesCompanion toCompanion(bool nullToAbsent) {
    return LocalFavoritesCompanion(
      id: Value(id),
      pluginId: Value(pluginId),
      mediaType: Value(mediaType),
      mediaId: Value(mediaId),
      createdAt: Value(createdAt),
    );
  }

  factory LocalFavorite.fromJson(Map<String, dynamic> json,
      {ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return LocalFavorite(
      id: serializer.fromJson<String>(json['id']),
      pluginId: serializer.fromJson<String>(json['pluginId']),
      mediaType: serializer.fromJson<String>(json['mediaType']),
      mediaId: serializer.fromJson<String>(json['mediaId']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'pluginId': serializer.toJson<String>(pluginId),
      'mediaType': serializer.toJson<String>(mediaType),
      'mediaId': serializer.toJson<String>(mediaId),
      'createdAt': serializer.toJson<DateTime>(createdAt),
    };
  }

  LocalFavorite copyWith(
          {String? id,
          String? pluginId,
          String? mediaType,
          String? mediaId,
          DateTime? createdAt}) =>
      LocalFavorite(
        id: id ?? this.id,
        pluginId: pluginId ?? this.pluginId,
        mediaType: mediaType ?? this.mediaType,
        mediaId: mediaId ?? this.mediaId,
        createdAt: createdAt ?? this.createdAt,
      );
  LocalFavorite copyWithCompanion(LocalFavoritesCompanion data) {
    return LocalFavorite(
      id: data.id.present ? data.id.value : this.id,
      pluginId: data.pluginId.present ? data.pluginId.value : this.pluginId,
      mediaType: data.mediaType.present ? data.mediaType.value : this.mediaType,
      mediaId: data.mediaId.present ? data.mediaId.value : this.mediaId,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('LocalFavorite(')
          ..write('id: $id, ')
          ..write('pluginId: $pluginId, ')
          ..write('mediaType: $mediaType, ')
          ..write('mediaId: $mediaId, ')
          ..write('createdAt: $createdAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(id, pluginId, mediaType, mediaId, createdAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is LocalFavorite &&
          other.id == this.id &&
          other.pluginId == this.pluginId &&
          other.mediaType == this.mediaType &&
          other.mediaId == this.mediaId &&
          other.createdAt == this.createdAt);
}

class LocalFavoritesCompanion extends UpdateCompanion<LocalFavorite> {
  final Value<String> id;
  final Value<String> pluginId;
  final Value<String> mediaType;
  final Value<String> mediaId;
  final Value<DateTime> createdAt;
  final Value<int> rowid;
  const LocalFavoritesCompanion({
    this.id = const Value.absent(),
    this.pluginId = const Value.absent(),
    this.mediaType = const Value.absent(),
    this.mediaId = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  LocalFavoritesCompanion.insert({
    required String id,
    required String pluginId,
    required String mediaType,
    required String mediaId,
    this.createdAt = const Value.absent(),
    this.rowid = const Value.absent(),
  })  : id = Value(id),
        pluginId = Value(pluginId),
        mediaType = Value(mediaType),
        mediaId = Value(mediaId);
  static Insertable<LocalFavorite> custom({
    Expression<String>? id,
    Expression<String>? pluginId,
    Expression<String>? mediaType,
    Expression<String>? mediaId,
    Expression<DateTime>? createdAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (pluginId != null) 'plugin_id': pluginId,
      if (mediaType != null) 'media_type': mediaType,
      if (mediaId != null) 'media_id': mediaId,
      if (createdAt != null) 'created_at': createdAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  LocalFavoritesCompanion copyWith(
      {Value<String>? id,
      Value<String>? pluginId,
      Value<String>? mediaType,
      Value<String>? mediaId,
      Value<DateTime>? createdAt,
      Value<int>? rowid}) {
    return LocalFavoritesCompanion(
      id: id ?? this.id,
      pluginId: pluginId ?? this.pluginId,
      mediaType: mediaType ?? this.mediaType,
      mediaId: mediaId ?? this.mediaId,
      createdAt: createdAt ?? this.createdAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (pluginId.present) {
      map['plugin_id'] = Variable<String>(pluginId.value);
    }
    if (mediaType.present) {
      map['media_type'] = Variable<String>(mediaType.value);
    }
    if (mediaId.present) {
      map['media_id'] = Variable<String>(mediaId.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('LocalFavoritesCompanion(')
          ..write('id: $id, ')
          ..write('pluginId: $pluginId, ')
          ..write('mediaType: $mediaType, ')
          ..write('mediaId: $mediaId, ')
          ..write('createdAt: $createdAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $LocalTrackingTable localTracking = $LocalTrackingTable(this);
  late final $LocalFavoritesTable localFavorites = $LocalFavoritesTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities =>
      [localTracking, localFavorites];
}

typedef $$LocalTrackingTableCreateCompanionBuilder = LocalTrackingCompanion
    Function({
  required String id,
  required String pluginId,
  required String mediaType,
  required String mediaId,
  Value<int> chapterNo,
  Value<String?> chapterId,
  Value<String?> chapterTitle,
  Value<double> progress,
  Value<int?> position,
  Value<String> status,
  Value<DateTime> updatedAt,
  Value<int> rowid,
});
typedef $$LocalTrackingTableUpdateCompanionBuilder = LocalTrackingCompanion
    Function({
  Value<String> id,
  Value<String> pluginId,
  Value<String> mediaType,
  Value<String> mediaId,
  Value<int> chapterNo,
  Value<String?> chapterId,
  Value<String?> chapterTitle,
  Value<double> progress,
  Value<int?> position,
  Value<String> status,
  Value<DateTime> updatedAt,
  Value<int> rowid,
});

class $$LocalTrackingTableFilterComposer
    extends Composer<_$AppDatabase, $LocalTrackingTable> {
  $$LocalTrackingTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get pluginId => $composableBuilder(
      column: $table.pluginId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get mediaType => $composableBuilder(
      column: $table.mediaType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get mediaId => $composableBuilder(
      column: $table.mediaId, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get chapterNo => $composableBuilder(
      column: $table.chapterNo, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get chapterId => $composableBuilder(
      column: $table.chapterId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get chapterTitle => $composableBuilder(
      column: $table.chapterTitle, builder: (column) => ColumnFilters(column));

  ColumnFilters<double> get progress => $composableBuilder(
      column: $table.progress, builder: (column) => ColumnFilters(column));

  ColumnFilters<int> get position => $composableBuilder(
      column: $table.position, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnFilters(column));
}

class $$LocalTrackingTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalTrackingTable> {
  $$LocalTrackingTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get pluginId => $composableBuilder(
      column: $table.pluginId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get mediaType => $composableBuilder(
      column: $table.mediaType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get mediaId => $composableBuilder(
      column: $table.mediaId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get chapterNo => $composableBuilder(
      column: $table.chapterNo, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get chapterId => $composableBuilder(
      column: $table.chapterId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get chapterTitle => $composableBuilder(
      column: $table.chapterTitle,
      builder: (column) => ColumnOrderings(column));

  ColumnOrderings<double> get progress => $composableBuilder(
      column: $table.progress, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<int> get position => $composableBuilder(
      column: $table.position, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get status => $composableBuilder(
      column: $table.status, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
      column: $table.updatedAt, builder: (column) => ColumnOrderings(column));
}

class $$LocalTrackingTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalTrackingTable> {
  $$LocalTrackingTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get pluginId =>
      $composableBuilder(column: $table.pluginId, builder: (column) => column);

  GeneratedColumn<String> get mediaType =>
      $composableBuilder(column: $table.mediaType, builder: (column) => column);

  GeneratedColumn<String> get mediaId =>
      $composableBuilder(column: $table.mediaId, builder: (column) => column);

  GeneratedColumn<int> get chapterNo =>
      $composableBuilder(column: $table.chapterNo, builder: (column) => column);

  GeneratedColumn<String> get chapterId =>
      $composableBuilder(column: $table.chapterId, builder: (column) => column);

  GeneratedColumn<String> get chapterTitle => $composableBuilder(
      column: $table.chapterTitle, builder: (column) => column);

  GeneratedColumn<double> get progress =>
      $composableBuilder(column: $table.progress, builder: (column) => column);

  GeneratedColumn<int> get position =>
      $composableBuilder(column: $table.position, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$LocalTrackingTableTableManager extends RootTableManager<
    _$AppDatabase,
    $LocalTrackingTable,
    LocalTrackingData,
    $$LocalTrackingTableFilterComposer,
    $$LocalTrackingTableOrderingComposer,
    $$LocalTrackingTableAnnotationComposer,
    $$LocalTrackingTableCreateCompanionBuilder,
    $$LocalTrackingTableUpdateCompanionBuilder,
    (
      LocalTrackingData,
      BaseReferences<_$AppDatabase, $LocalTrackingTable, LocalTrackingData>
    ),
    LocalTrackingData,
    PrefetchHooks Function()> {
  $$LocalTrackingTableTableManager(_$AppDatabase db, $LocalTrackingTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalTrackingTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalTrackingTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalTrackingTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> pluginId = const Value.absent(),
            Value<String> mediaType = const Value.absent(),
            Value<String> mediaId = const Value.absent(),
            Value<int> chapterNo = const Value.absent(),
            Value<String?> chapterId = const Value.absent(),
            Value<String?> chapterTitle = const Value.absent(),
            Value<double> progress = const Value.absent(),
            Value<int?> position = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<DateTime> updatedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalTrackingCompanion(
            id: id,
            pluginId: pluginId,
            mediaType: mediaType,
            mediaId: mediaId,
            chapterNo: chapterNo,
            chapterId: chapterId,
            chapterTitle: chapterTitle,
            progress: progress,
            position: position,
            status: status,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String pluginId,
            required String mediaType,
            required String mediaId,
            Value<int> chapterNo = const Value.absent(),
            Value<String?> chapterId = const Value.absent(),
            Value<String?> chapterTitle = const Value.absent(),
            Value<double> progress = const Value.absent(),
            Value<int?> position = const Value.absent(),
            Value<String> status = const Value.absent(),
            Value<DateTime> updatedAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalTrackingCompanion.insert(
            id: id,
            pluginId: pluginId,
            mediaType: mediaType,
            mediaId: mediaId,
            chapterNo: chapterNo,
            chapterId: chapterId,
            chapterTitle: chapterTitle,
            progress: progress,
            position: position,
            status: status,
            updatedAt: updatedAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (
                    e.readTable<$LocalTrackingTable, LocalTrackingData>(table),
                    BaseReferences<_$AppDatabase, $LocalTrackingTable,
                        LocalTrackingData>(db, table, e)
                  ))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$LocalTrackingTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $LocalTrackingTable,
    LocalTrackingData,
    $$LocalTrackingTableFilterComposer,
    $$LocalTrackingTableOrderingComposer,
    $$LocalTrackingTableAnnotationComposer,
    $$LocalTrackingTableCreateCompanionBuilder,
    $$LocalTrackingTableUpdateCompanionBuilder,
    (
      LocalTrackingData,
      BaseReferences<_$AppDatabase, $LocalTrackingTable, LocalTrackingData>
    ),
    LocalTrackingData,
    PrefetchHooks Function()>;
typedef $$LocalFavoritesTableCreateCompanionBuilder = LocalFavoritesCompanion
    Function({
  required String id,
  required String pluginId,
  required String mediaType,
  required String mediaId,
  Value<DateTime> createdAt,
  Value<int> rowid,
});
typedef $$LocalFavoritesTableUpdateCompanionBuilder = LocalFavoritesCompanion
    Function({
  Value<String> id,
  Value<String> pluginId,
  Value<String> mediaType,
  Value<String> mediaId,
  Value<DateTime> createdAt,
  Value<int> rowid,
});

class $$LocalFavoritesTableFilterComposer
    extends Composer<_$AppDatabase, $LocalFavoritesTable> {
  $$LocalFavoritesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get pluginId => $composableBuilder(
      column: $table.pluginId, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get mediaType => $composableBuilder(
      column: $table.mediaType, builder: (column) => ColumnFilters(column));

  ColumnFilters<String> get mediaId => $composableBuilder(
      column: $table.mediaId, builder: (column) => ColumnFilters(column));

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnFilters(column));
}

class $$LocalFavoritesTableOrderingComposer
    extends Composer<_$AppDatabase, $LocalFavoritesTable> {
  $$LocalFavoritesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
      column: $table.id, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get pluginId => $composableBuilder(
      column: $table.pluginId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get mediaType => $composableBuilder(
      column: $table.mediaType, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<String> get mediaId => $composableBuilder(
      column: $table.mediaId, builder: (column) => ColumnOrderings(column));

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
      column: $table.createdAt, builder: (column) => ColumnOrderings(column));
}

class $$LocalFavoritesTableAnnotationComposer
    extends Composer<_$AppDatabase, $LocalFavoritesTable> {
  $$LocalFavoritesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get pluginId =>
      $composableBuilder(column: $table.pluginId, builder: (column) => column);

  GeneratedColumn<String> get mediaType =>
      $composableBuilder(column: $table.mediaType, builder: (column) => column);

  GeneratedColumn<String> get mediaId =>
      $composableBuilder(column: $table.mediaId, builder: (column) => column);

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);
}

class $$LocalFavoritesTableTableManager extends RootTableManager<
    _$AppDatabase,
    $LocalFavoritesTable,
    LocalFavorite,
    $$LocalFavoritesTableFilterComposer,
    $$LocalFavoritesTableOrderingComposer,
    $$LocalFavoritesTableAnnotationComposer,
    $$LocalFavoritesTableCreateCompanionBuilder,
    $$LocalFavoritesTableUpdateCompanionBuilder,
    (
      LocalFavorite,
      BaseReferences<_$AppDatabase, $LocalFavoritesTable, LocalFavorite>
    ),
    LocalFavorite,
    PrefetchHooks Function()> {
  $$LocalFavoritesTableTableManager(
      _$AppDatabase db, $LocalFavoritesTable table)
      : super(TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$LocalFavoritesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$LocalFavoritesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$LocalFavoritesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback: ({
            Value<String> id = const Value.absent(),
            Value<String> pluginId = const Value.absent(),
            Value<String> mediaType = const Value.absent(),
            Value<String> mediaId = const Value.absent(),
            Value<DateTime> createdAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalFavoritesCompanion(
            id: id,
            pluginId: pluginId,
            mediaType: mediaType,
            mediaId: mediaId,
            createdAt: createdAt,
            rowid: rowid,
          ),
          createCompanionCallback: ({
            required String id,
            required String pluginId,
            required String mediaType,
            required String mediaId,
            Value<DateTime> createdAt = const Value.absent(),
            Value<int> rowid = const Value.absent(),
          }) =>
              LocalFavoritesCompanion.insert(
            id: id,
            pluginId: pluginId,
            mediaType: mediaType,
            mediaId: mediaId,
            createdAt: createdAt,
            rowid: rowid,
          ),
          withReferenceMapper: (p0) => p0
              .map((e) => (
                    e.readTable<$LocalFavoritesTable, LocalFavorite>(table),
                    BaseReferences<_$AppDatabase, $LocalFavoritesTable,
                        LocalFavorite>(db, table, e)
                  ))
              .toList(),
          prefetchHooksCallback: null,
        ));
}

typedef $$LocalFavoritesTableProcessedTableManager = ProcessedTableManager<
    _$AppDatabase,
    $LocalFavoritesTable,
    LocalFavorite,
    $$LocalFavoritesTableFilterComposer,
    $$LocalFavoritesTableOrderingComposer,
    $$LocalFavoritesTableAnnotationComposer,
    $$LocalFavoritesTableCreateCompanionBuilder,
    $$LocalFavoritesTableUpdateCompanionBuilder,
    (
      LocalFavorite,
      BaseReferences<_$AppDatabase, $LocalFavoritesTable, LocalFavorite>
    ),
    LocalFavorite,
    PrefetchHooks Function()>;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$LocalTrackingTableTableManager get localTracking =>
      $$LocalTrackingTableTableManager(_db, _db.localTracking);
  $$LocalFavoritesTableTableManager get localFavorites =>
      $$LocalFavoritesTableTableManager(_db, _db.localFavorites);
}
