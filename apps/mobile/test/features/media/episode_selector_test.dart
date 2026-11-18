import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/playback/chapter_groups.dart';
import 'package:titanhub/features/media/models/media_models.dart';
import 'package:titanhub/features/media/widgets/episode_selector.dart';

List<ChapterLine> _conanLikeLines() {
  return groupChapterLines([
    for (var n = 1; n <= 279; n++)
      Chapter(id: 'l1-$n', title: '线路1·第$n集', groupId: 'line-1', groupName: '线路1'),
    for (var n = 1; n <= 1265; n++)
      Chapter(id: 'l2-$n', title: '线路2·第$n集', groupId: 'line-2', groupName: '线路2'),
  ]);
}

Future<List<(Chapter, ChapterLine)>> _pump(
  WidgetTester tester, {
  required List<ChapterLine> lines,
  String? activeChapterId,
  String? activeGroupId,
}) async {
  final selections = <(Chapter, ChapterLine)>[];
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(
      body: SingleChildScrollView(
        child: EpisodeSelector(
          lines: lines,
          activeChapterId: activeChapterId,
          activeGroupId: activeGroupId,
          onSelect: (chapter, line) => selections.add((chapter, line)),
        ),
      ),
    ),
  ));
  return selections;
}

void main() {
  testWidgets('默认定位到当前集所在线路与100集分段', (tester) async {
    await _pump(tester, lines: _conanLikeLines(), activeChapterId: 'l2-1001');

    expect(find.text('第1001集'), findsOneWidget);
    expect(find.text('第1000集'), findsNothing);
    expect(find.text('第1集'), findsNothing);
    expect(find.text('1001-1100'), findsOneWidget);
  });

  testWidgets('切换线路时跳到同集号所在分段', (tester) async {
    await _pump(tester, lines: _conanLikeLines(), activeChapterId: 'l2-251');
    expect(find.text('第251集'), findsOneWidget);

    await tester.tap(find.text('线路1 (279)'));
    await tester.pump();

    expect(find.text('201-279'), findsOneWidget);
    expect(find.text('第251集'), findsOneWidget);
    expect(find.text('第201集'), findsOneWidget);
  });

  testWidgets('目标线路没有同集号时夹紧到最后一段', (tester) async {
    await _pump(tester, lines: _conanLikeLines(), activeChapterId: 'l2-1001');

    await tester.tap(find.text('线路1 (279)'));
    await tester.pump();

    expect(find.text('第201集'), findsOneWidget);
    expect(find.text('第1001集'), findsNothing);
  });

  testWidgets('点选回传章节与所属线路，用于携带线路上下文', (tester) async {
    final selections = await _pump(tester, lines: _conanLikeLines(), activeChapterId: 'l1-5');

    await tester.tap(find.text('第7集'));
    await tester.pump();

    expect(selections, hasLength(1));
    expect(selections.single.$1.id, 'l1-7');
    expect(selections.single.$2.id, 'line-1');
  });

  testWidgets('跨线重复ID只按显式线路高亮定位', (tester) async {
    final lines = groupChapterLines([
      Chapter(id: 'shared', title: '第1集', groupId: 'a', groupName: 'A'),
      Chapter(id: 'shared', title: '第1集', groupId: 'b', groupName: 'B'),
      Chapter(id: 'b-2', title: '第2集', groupId: 'b', groupName: 'B'),
    ]);
    final selections =
        await _pump(tester, lines: lines, activeChapterId: 'shared', activeGroupId: 'b');

    expect(find.text('第2集'), findsOneWidget);
    await tester.tap(find.text('第1集'));
    await tester.pump();
    expect(selections.single.$2.id, 'b');
  });

  testWidgets('单线路少量章节不显示线路与分段选择', (tester) async {
    final lines = groupChapterLines([
      Chapter(id: '1', title: '第1集'),
      Chapter(id: '2', title: '第2集'),
    ]);
    await _pump(tester, lines: lines);

    expect(find.byType(ChoiceChip), findsNothing);
    expect(find.text('第1集'), findsOneWidget);
  });
}
