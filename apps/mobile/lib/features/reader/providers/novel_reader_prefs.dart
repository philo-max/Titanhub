import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

enum NovelTheme { obsidian, sepia, mint, light }

enum NovelReadMode { scroll, paged }

@immutable
class NovelReaderPrefs {
  const NovelReaderPrefs({
    this.theme = NovelTheme.obsidian,
    this.readMode = NovelReadMode.scroll,
    this.fontSize = 18.0,
    this.lineHeight = 1.8,
    this.serifFont = true,
  });

  final NovelTheme theme;
  final NovelReadMode readMode;
  final double fontSize;
  final double lineHeight;
  final bool serifFont;

  NovelReaderPrefs copyWith({
    NovelTheme? theme,
    NovelReadMode? readMode,
    double? fontSize,
    double? lineHeight,
    bool? serifFont,
  }) {
    return NovelReaderPrefs(
      theme: theme ?? this.theme,
      readMode: readMode ?? this.readMode,
      fontSize: fontSize ?? this.fontSize,
      lineHeight: lineHeight ?? this.lineHeight,
      serifFont: serifFont ?? this.serifFont,
    );
  }

  Map<String, dynamic> toJson() => {
        'theme': theme.name,
        'readMode': readMode.name,
        'fontSize': fontSize,
        'lineHeight': lineHeight,
        'serifFont': serifFont,
      };

  factory NovelReaderPrefs.fromJson(Map<String, dynamic> json) {
    final themeName = '${json['theme'] ?? ''}';
    final modeName = '${json['readMode'] ?? ''}';
    final fontSizeRaw = (json['fontSize'] as num?)?.toDouble() ?? 18.0;
    final lineHeightRaw = (json['lineHeight'] as num?)?.toDouble() ?? 1.8;
    return NovelReaderPrefs(
      theme: NovelTheme.values.firstWhere(
        (t) => t.name == themeName,
        orElse: () => NovelTheme.obsidian,
      ),
      readMode: NovelReadMode.values.firstWhere(
        (m) => m.name == modeName,
        orElse: () => NovelReadMode.scroll,
      ),
      fontSize: fontSizeRaw.clamp(12.0, 32.0),
      lineHeight: lineHeightRaw.clamp(1.3, 2.4),
      serifFont: json['serifFont'] is bool ? json['serifFont'] as bool : true,
    );
  }
}

class NovelReaderPrefsNotifier extends StateNotifier<NovelReaderPrefs> {
  NovelReaderPrefsNotifier({
    Future<Directory> Function()? directoryProvider,
    bool autoLoad = true,
  })  : _directoryProvider = directoryProvider ?? getApplicationDocumentsDirectory,
        super(const NovelReaderPrefs()) {
    if (autoLoad) {
      load();
    }
  }

  static const String _fileName = 'novel_reader_prefs.json';
  final Future<Directory> Function() _directoryProvider;
  bool _dirty = false;

  Future<File?> _prefsFile() async {
    try {
      final dir = await _directoryProvider();
      return File(p.join(dir.path, _fileName));
    } catch (_) {
      return null;
    }
  }

  Future<void> load() async {
    try {
      final file = await _prefsFile();
      if (file == null || !await file.exists()) return;
      final raw = await file.readAsString();
      if (_dirty || !mounted) return;
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        state = NovelReaderPrefs.fromJson(Map<String, dynamic>.from(decoded));
      }
    } catch (_) {
      // Best-effort persistence; unit tests without platform channels fall back to defaults.
    }
  }

  Future<void> _persist(NovelReaderPrefs next) async {
    try {
      final file = await _prefsFile();
      if (file == null) return;
      await file.parent.create(recursive: true);
      await file.writeAsString(jsonEncode(next.toJson()));
    } catch (_) {}
  }

  void _update(NovelReaderPrefs next) {
    _dirty = true;
    state = next;
    _persist(next);
  }

  void setTheme(NovelTheme theme) => _update(state.copyWith(theme: theme));

  void setReadMode(NovelReadMode mode) => _update(state.copyWith(readMode: mode));

  void setFontSize(double fontSize) =>
      _update(state.copyWith(fontSize: fontSize.clamp(12.0, 32.0)));

  void setLineHeight(double lineHeight) =>
      _update(state.copyWith(lineHeight: double.parse(lineHeight.clamp(1.3, 2.4).toStringAsFixed(1))));

  void setSerifFont(bool serifFont) => _update(state.copyWith(serifFont: serifFont));
}

final novelReaderPrefsProvider =
    StateNotifierProvider<NovelReaderPrefsNotifier, NovelReaderPrefs>((ref) {
  return NovelReaderPrefsNotifier();
});
