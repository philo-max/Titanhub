import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'legado_book_source.dart';

/// Persists user-imported Legado JSON book sources on local disk so they survive
/// app restarts and deduplicate cleanly by canonical `stableId`.
class LegadoStore {
  LegadoStore({Future<Directory> Function()? directoryProvider})
      : _directoryProvider = directoryProvider ?? getApplicationDocumentsDirectory;

  static const String _fileName = 'legado_sources.json';
  final Future<Directory> Function() _directoryProvider;

  Future<File?> _file() async {
    try {
      final dir = await _directoryProvider();
      return File(p.join(dir.path, _fileName));
    } catch (_) {
      return null;
    }
  }

  Future<List<LegadoBookSource>> loadAll() async {
    try {
      final file = await _file();
      if (file == null || !await file.exists()) return const [];
      final raw = await file.readAsString();
      if (raw.trim().isEmpty) return const [];
      return LegadoBookSource.parseList(raw);
    } catch (_) {
      return const [];
    }
  }

  Future<void> saveAll(List<LegadoBookSource> sources) async {
    try {
      final file = await _file();
      if (file == null) return;
      await file.parent.create(recursive: true);
      final encoded = jsonEncode([for (final s in sources) s.toJson()]);
      await file.writeAsString(encoded);
    } catch (_) {}
  }

  Future<List<LegadoBookSource>> upsertAll(List<LegadoBookSource> incoming) async {
    final existing = await loadAll();
    final byId = <String, LegadoBookSource>{
      for (final s in existing) s.stableId: s,
    };
    for (final s in incoming) {
      byId[s.stableId] = s;
    }
    final merged = byId.values.toList();
    await saveAll(merged);
    return merged;
  }

  Future<List<LegadoBookSource>> removeById(String stableId) async {
    final existing = await loadAll();
    final filtered = [
      for (final s in existing)
        if (s.stableId != stableId) s,
    ];
    await saveAll(filtered);
    return filtered;
  }
}

final legadoStoreProvider = Provider<LegadoStore>((ref) => LegadoStore());
