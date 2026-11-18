import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/playback/chapter_groups.dart';
import 'package:titanhub/features/media/models/media_models.dart';

Chapter _ep(String id, String title, {String? group, String? name, int? no}) =>
    Chapter(id: id, title: title, groupId: group, groupName: name, chapterNo: no);

List<Chapter> _conanLikeFixture() {
  return [
    for (var n = 1; n <= 279; n++)
      _ep('/play/1-1-$n.html', '线路1·第$n集', group: 'line-1', name: '线路1'),
    for (var n = 1265; n >= 1; n--)
      _ep('/play/1-2-$n.html', '线路2·第$n集', group: 'line-2', name: '线路2'),
  ];
}

void main() {
  group('线路分组', () {
    test('1544条记录按线路拆成279与1265，不合并成一条', () {
      final lines = groupChapterLines(_conanLikeFixture());
      expect(lines.map((line) => line.id), ['line-1', 'line-2']);
      expect(lines.map((line) => line.chapters.length), [279, 1265]);
      expect(lines[1].chapters.first.id, '/play/1-2-1.html');
      expect(lines[1].chapters.last.id, '/play/1-2-1265.html');
    });

    test('桌面lineId/lineName经模型解析后同样成组', () {
      final chapters = [
        Chapter.fromJson({'id': 'a', 'title': '第2集', 'lineId': 'line-1', 'lineName': '线路1'}),
        Chapter.fromJson({'id': 'b', 'title': '第1集', 'lineId': 'line-1', 'lineName': '线路1'}),
        Chapter.fromJson({'id': 'c', 'title': '第1集', 'lineId': 'line-2', 'lineName': '线路2'}),
      ];
      final lines = groupChapterLines(chapters);
      expect(lines.map((line) => line.id), ['line-1', 'line-2']);
      expect(lines.first.chapters.map((c) => c.id), ['b', 'a']);
    });

    test('无线路字段的旧来源整体为一条线路，保持原顺序', () {
      final lines = groupChapterLines([_ep('x', '序章'), _ep('y', '番外')]);
      expect(lines, hasLength(1));
      expect(lines.single.id, '');
      expect(lineDisplayName(lines, 0), '线路1');
    });
  });

  group('自然排序', () {
    test('数字按数值而非字典序', () {
      final lines = groupChapterLines([
        _ep('10', '第10集'),
        _ep('2', '第2集'),
        _ep('1', '第1集'),
      ]);
      expect(lines.single.chapters.map((c) => c.id), ['1', '2', '10']);
    });

    test('未知编号留在原位，已知编号在其余槽位内排序', () {
      final lines = groupChapterLines([
        _ep('e3', 'EP03'),
        _ep('sp', '特别篇'),
        _ep('e1', 'EP01'),
        _ep('ova', 'OVA'),
        _ep('e2', 'EP02'),
      ]);
      expect(lines.single.chapters.map((c) => c.id), ['e1', 'sp', 'e2', 'ova', 'e3']);
    });

    test('同编号保持稳定先后', () {
      final lines = groupChapterLines([
        _ep('b', '第1集 下'),
        _ep('a', '第1集 上'),
      ]);
      expect(lines.single.chapters.map((c) => c.id), ['b', 'a']);
    });

    test('解析中文、去线路前缀并优先显式chapterNo', () {
      expect(episodeNumber(_ep('a', '第十二话')), 12);
      expect(episodeNumber(_ep('a', '第一百零五集')), 105);
      expect(episodeNumber(_ep('a', '线路2·第7集', name: '线路2')), 7);
      expect(episodeLabel(_ep('a', '线路2·第7集', name: '线路2')), '第7集');
      expect(episodeNumber(_ep('a', '第3集', no: 30)), 30);
      expect(episodeNumber(_ep('a', '2024年版')), isNull);
      expect(episodeNumber(_ep('a', '第1季')), isNull);
    });
  });

  group('跨线重复ID与定位', () {
    final chapters = [
      _ep('shared', '第1集', group: 'line-1', name: '线路1'),
      _ep('l1-2', '第2集', group: 'line-1', name: '线路1'),
      _ep('shared', '第1集', group: 'line-2', name: '线路2'),
      _ep('l2-2', '第2集', group: 'line-2', name: '线路2'),
      _ep('l2-3', '第3集', group: 'line-2', name: '线路2'),
    ];
    final lines = groupChapterLines(chapters);

    test('带线路上下文时定位到指定线路', () {
      expect(locateChapter(lines, 'shared', groupId: 'line-2'), const ChapterLocation(1, 0));
      expect(nextInLine(lines, 'shared', groupId: 'line-2')?.id, 'l2-2');
      expect(nextInLine(lines, 'shared', groupId: 'line-1')?.id, 'l1-2');
    });

    test('无上下文且重复时不猜', () {
      expect(locateChapter(lines, 'shared'), isNull);
      expect(nextInLine(lines, 'shared'), isNull);
    });

    test('唯一ID无上下文也能定位', () {
      expect(locateChapter(lines, 'l2-2'), const ChapterLocation(1, 1));
    });

    test('末集停住，不跨到其他线路', () {
      expect(nextInLine(lines, 'l1-2'), isNull);
      expect(nextInLine(lines, 'l2-3'), isNull);
    });

    test('未知章节返回空', () {
      expect(locateChapter(lines, 'missing'), isNull);
      expect(locateChapter(lines, null), isNull);
    });
  });

  group('100集分段', () {
    test('分段边界与标签', () {
      final lines = groupChapterLines(_conanLikeFixture());
      final ranges = pageRanges(lines[1].chapters.length);
      expect(ranges, hasLength(13));
      expect(ranges.last.start, 1200);
      expect(ranges.last.end, 1265);
      expect(pageLabel(lines[1].chapters, ranges.first), '1-100');
      expect(pageLabel(lines[1].chapters, ranges.last), '1201-1265');
      expect(pageRanges(0), isEmpty);
    });

    test('当前集定位到所在分段', () {
      final lines = groupChapterLines(_conanLikeFixture());
      final location = locateChapter(lines, '/play/1-2-1001.html')!;
      expect(location.line, 1);
      expect(location.page, 10);
    });

    test('切线时优先跳到同集号所在分段，否则夹紧到最后一段', () {
      final lines = groupChapterLines(_conanLikeFixture());
      final active = lines[1].chapters[250];
      expect(selectLinePage(lines, 0, 9, active), 2);
      final beyond = lines[1].chapters[1000];
      expect(selectLinePage(lines, 0, 10, beyond), 2);
      expect(selectLinePage(lines, 1, 1, null), 1);
    });
  });

  group('存档集号与自然结束', () {
    test('存档集号来自章节编号，无编号时用线路内序号', () {
      final lines = groupChapterLines([_ep('a', '序章'), _ep('b', '第2集')]);
      expect(chapterNoAt(lines, const ChapterLocation(0, 1)), 2);
      expect(chapterNoAt(lines, const ChapterLocation(0, 0)), 1);
    });

    test('只有接近片尾才算自然播完', () {
      const duration = Duration(minutes: 24);
      expect(reachedNaturalEnd(position: duration, duration: duration), isTrue);
      expect(reachedNaturalEnd(position: const Duration(minutes: 3), duration: duration), isFalse);
      expect(reachedNaturalEnd(position: Duration.zero, duration: Duration.zero), isFalse);
    });
  });
}
