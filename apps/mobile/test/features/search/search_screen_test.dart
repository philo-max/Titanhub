import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sandbox/local_plugin_runner.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/features/search/views/search_screen.dart';

class _EmptyRunner extends LocalPluginRunner {
  final calls = <String>[];

  @override
  Future<dynamic> call(String pluginId, String method, List<dynamic> args) async {
    calls.add(pluginId);
    return const [];
  }
}

Future<ProviderContainer> _pump(WidgetTester tester, _EmptyRunner runner) async {
  tester.view.physicalSize = const Size(1080, 3200);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  final container = ProviderContainer(overrides: [
    localPluginRunnerProvider.overrideWithValue(runner),
  ]);
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: const MaterialApp(home: SearchScreen()),
  ));
  return container;
}

Future<void> _search(WidgetTester tester, String query) async {
  await tester.enterText(find.byType(TextField), query);
  await tester.testTextInput.receiveAction(TextInputAction.done);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('首页显示全部与四个分类选择，默认全部', (tester) async {
    final container = await _pump(tester, _EmptyRunner());
    for (final filter in MediaTypeFilter.values) {
      expect(find.byKey(Key('search-type-${filter.name}')), findsOneWidget);
    }
    expect(container.read(selectedMediaTypeProvider), MediaTypeFilter.all);
  });

  testWidgets('点击首页分类卡片实际选择分类且不改来源开关', (tester) async {
    final container = await _pump(tester, _EmptyRunner());
    final enabled = container.read(enabledSourceIdsProvider);
    await tester.tap(find.byKey(const Key('category-card-manga')));
    await tester.pump();
    expect(container.read(selectedMediaTypeProvider), MediaTypeFilter.manga);
    expect(find.textContaining('MangaDex 漫画'), findsWidgets);
    expect(container.read(enabledSourceIdsProvider), enabled);
  });

  testWidgets('切换分类后同一关键词按新分类重新搜索', (tester) async {
    final runner = _EmptyRunner();
    final container = await _pump(tester, runner);
    await _search(tester, '海贼');
    expect(runner.calls.toSet(), {for (final s in bundledSources) s.id});
    runner.calls.clear();
    await tester.tap(find.byKey(const Key('search-type-manga')));
    await tester.pumpAndSettle();
    expect(container.read(selectedMediaTypeProvider), MediaTypeFilter.manga);
    expect(runner.calls, ['mangadex']);
  });

  testWidgets('分类没有本机来源时明确提示且不请求来源', (tester) async {
    final runner = _EmptyRunner();
    await _pump(tester, runner);
    await tester.tap(find.byKey(const Key('search-type-novel')));
    await tester.pump();
    expect(find.textContaining('「小说」分类没有已启用的本机来源'), findsOneWidget);
    await _search(tester, '海贼');
    expect(runner.calls, isEmpty);
    expect(find.text('未搜索到相关内容。'), findsOneWidget);
    expect(find.textContaining('小说'), findsWidgets);
  });
  testWidgets('首页入口统一为“来源配置”，不出现来源项目名', (tester) async {
    await _pump(tester, _EmptyRunner());
    expect(find.byKey(const Key('home-sources-entry')), findsOneWidget);
    expect(find.text('来源配置'), findsOneWidget);
    expect(find.textContaining('Kazumi'), findsNothing);
  });
}
