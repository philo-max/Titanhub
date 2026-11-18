import '../../features/media/models/media_models.dart';

const int episodePageSize = 100;
const Duration naturalEndTolerance = Duration(seconds: 5);

class ChapterLine {
  const ChapterLine({required this.id, required this.name, required this.chapters});

  final String id;
  final String name;
  final List<Chapter> chapters;
}

class ChapterLocation {
  const ChapterLocation(this.line, this.index);

  final int line;
  final int index;

  int get page => index ~/ episodePageSize;

  @override
  bool operator ==(Object other) =>
      other is ChapterLocation && other.line == line && other.index == index;

  @override
  int get hashCode => Object.hash(line, index);

  @override
  String toString() => 'ChapterLocation($line, $index)';
}

class EpisodePage {
  const EpisodePage(this.start, this.end);

  final int start;
  final int end;
}

const String _boundary = r'(?=$|[\s(（\[【:：\-—_·])';
final List<RegExp> _arabicPatterns = [
  RegExp(r'^(\d+)$'),
  RegExp('^第\\s*(\\d+)\\s*[集话話回期]$_boundary'),
  RegExp('^(\\d+)\\s*[集话話]$_boundary'),
  RegExp('^(?:EP|E|Episode)\\.?\\s*(\\d+)$_boundary', caseSensitive: false),
  RegExp(r'^(\d+)\.\s*(?=[^\d\s.])'),
  RegExp(r'^(0\d+)\s+(?=\S)'),
];
final RegExp _chinesePattern = RegExp('^第([零〇一二两三四五六七八九十百千]+)[集话話回期]$_boundary');
const Set<String> _chineseZeros = {'零', '〇'};
const Map<String, int> _chineseDigits = {
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};
const Map<String, int> _chineseUnits = {'十': 10, '百': 100, '千': 1000};

int? _parseChineseNumber(String text) {
  var total = 0;
  int? digit;
  var lastUnit = 1 << 30;
  for (final char in text.split('')) {
    if (_chineseZeros.contains(char)) {
      if (digit != null) return null;
      continue;
    }
    final value = _chineseDigits[char];
    if (value != null) {
      if (digit != null) return null;
      digit = value;
      continue;
    }
    final unit = _chineseUnits[char]!;
    if (unit >= lastUnit) return null;
    final multiplier = digit ?? (unit == 10 && total == 0 ? 1 : null);
    if (multiplier == null) return null;
    total += multiplier * unit;
    digit = null;
    lastUnit = unit;
  }
  total += digit ?? 0;
  return total > 0 ? total : null;
}

String lineKeyOf(Chapter chapter) => chapter.groupId ?? chapter.groupName ?? '';

String episodeLabel(Chapter chapter) {
  final title = chapter.title.trim();
  final name = chapter.groupName;
  if (name == null) return title;
  final prefix = '$name·';
  return title.startsWith(prefix) ? title.substring(prefix.length).trim() : title;
}

int? episodeNumber(Chapter chapter) {
  final explicit = chapter.chapterNo;
  if (explicit != null) return explicit >= 0 ? explicit : null;
  final label = episodeLabel(chapter);
  for (final pattern in _arabicPatterns) {
    final match = pattern.firstMatch(label);
    if (match != null) return int.parse(match.group(1)!);
  }
  final chinese = _chinesePattern.firstMatch(label);
  return chinese == null ? null : _parseChineseNumber(chinese.group(1)!);
}

List<Chapter> _sortLine(List<Chapter> chapters) {
  final numbered = <({Chapter chapter, int index, int number})>[];
  for (var i = 0; i < chapters.length; i++) {
    final number = episodeNumber(chapters[i]);
    if (number != null) numbered.add((chapter: chapters[i], index: i, number: number));
  }
  final ordered = [...numbered]
    ..sort((a, b) {
      final byNumber = a.number.compareTo(b.number);
      return byNumber != 0 ? byNumber : a.index.compareTo(b.index);
    });
  final result = [...chapters];
  for (var slot = 0; slot < numbered.length; slot++) {
    result[numbered[slot].index] = ordered[slot].chapter;
  }
  return result;
}

List<ChapterLine> groupChapterLines(List<Chapter> chapters) {
  final buckets = <String, List<Chapter>>{};
  final names = <String, String>{};
  for (final chapter in chapters) {
    final key = lineKeyOf(chapter);
    buckets.putIfAbsent(key, () => []).add(chapter);
    names.putIfAbsent(key, () => chapter.groupName ?? chapter.groupId ?? '');
  }
  return [
    for (final entry in buckets.entries)
      ChapterLine(id: entry.key, name: names[entry.key]!, chapters: _sortLine(entry.value)),
  ];
}

String lineDisplayName(List<ChapterLine> lines, int line) {
  final name = lines[line].name;
  return name.isNotEmpty ? name : '线路${line + 1}';
}

ChapterLocation? locateChapter(List<ChapterLine> lines, String? chapterId, {String? groupId}) {
  if (chapterId == null || chapterId.isEmpty) return null;
  final matches = <ChapterLocation>[];
  for (var line = 0; line < lines.length; line++) {
    final index = lines[line].chapters.indexWhere((chapter) => chapter.id == chapterId);
    if (index >= 0) matches.add(ChapterLocation(line, index));
  }
  if (groupId != null) {
    for (final match in matches) {
      if (lines[match.line].id == groupId) return match;
    }
  }
  return matches.length == 1 ? matches.single : null;
}

Chapter? nextInLine(List<ChapterLine> lines, String chapterId, {String? groupId}) {
  final location = locateChapter(lines, chapterId, groupId: groupId);
  if (location == null) return null;
  final chapters = lines[location.line].chapters;
  return location.index + 1 < chapters.length ? chapters[location.index + 1] : null;
}

int indexOfSameEpisode(ChapterLine line, Chapter? chapter) {
  final episode = chapter == null ? null : episodeNumber(chapter);
  if (episode == null) return -1;
  return line.chapters.indexWhere((entry) => episodeNumber(entry) == episode);
}

List<EpisodePage> pageRanges(int count, {int size = episodePageSize}) {
  return [
    for (var start = 0; start < count; start += size)
      EpisodePage(start, start + size < count ? start + size : count),
  ];
}

int selectLinePage(List<ChapterLine> lines, int line, int browsedPage, Chapter? activeChapter) {
  final match = indexOfSameEpisode(lines[line], activeChapter);
  if (match >= 0) return match ~/ episodePageSize;
  final pages = pageRanges(lines[line].chapters.length).length;
  final lastPage = pages > 0 ? pages - 1 : 0;
  return browsedPage.clamp(0, lastPage);
}

String pageLabel(List<Chapter> chapters, EpisodePage range) {
  final first = episodeNumber(chapters[range.start]) ?? range.start + 1;
  final last = episodeNumber(chapters[range.end - 1]) ?? range.end;
  return '$first-$last';
}

int chapterNoAt(List<ChapterLine> lines, ChapterLocation location) {
  final chapter = lines[location.line].chapters[location.index];
  return episodeNumber(chapter) ?? location.index + 1;
}

bool reachedNaturalEnd({required Duration position, required Duration duration}) {
  if (duration <= Duration.zero) return false;
  return position >= duration - naturalEndTolerance;
}
