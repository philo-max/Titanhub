import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:titanhub/core/sandbox/local_plugin_runner.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/core/sources/media_source.dart';
import 'package:titanhub/core/storage/app_database.dart';
import 'package:titanhub/features/home/views/main_shell_screen.dart';
import 'package:titanhub/features/tracking/sync_provider.dart';

class _FakeRunner extends LocalPluginRunner {
  @override
  Future<dynamic> call(String pluginId, String method, List<dynamic> args) async {
    if (method == 'explore') {
      return [
        {'id': 'demo-1', 'title': '测试作品', 'cover': ''},
      ];
    }
    return const [];
  }
}

class _EmptyDb implements AppDatabase {
  @override
  Future<List<LocalFavorite>> getAllFavorites() async => const [];

  @override
  Future<List<LocalTrackingData>> getAllTracking() async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  testWidgets('MainShellScreen switches between 4 ACG hub tabs and navigates to /search',
      (tester) async {
    const sources = [
      MediaSource(
        id: 'bangumi',
        name: 'Bangumi',
        types: ['anime'],
        capabilities: {MediaCapability.search, MediaCapability.detail},
      ),
      MediaSource(
        id: 'mangadex',
        name: 'MangaDex',
        types: ['manga'],
        capabilities: {MediaCapability.search, MediaCapability.detail},
      ),
    ];

    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(
          path: '/',
          builder: (_, __) => const MainShellScreen(),
        ),
        GoRoute(
          path: '/search',
          builder: (_, state) => Scaffold(
            body: Text('SEARCH:${state.uri.queryParameters['type']}'),
          ),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          localSourcesProvider.overrideWithValue(sources),
          enabledSourceIdsProvider.overrideWith((_) => {'bangumi', 'mangadex'}),
          localPluginRunnerProvider.overrideWithValue(_FakeRunner()),
          databaseProvider.overrideWithValue(_EmptyDb()),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Titanhub · 番剧'), findsOneWidget);
    expect(find.text('新番 / 热门番剧推荐'), findsOneWidget);
    expect(find.text('测试作品'), findsOneWidget);

    await tester.tap(find.text('漫画').last);
    await tester.pumpAndSettle();
    expect(find.text('Titanhub · 漫画'), findsOneWidget);
    expect(find.text('漫画来源发现页'), findsOneWidget);

    await tester.tap(find.text('书架').last);
    await tester.pumpAndSettle();
    expect(find.text('我的书架 & 记录'), findsOneWidget);

    await tester.tap(find.text('源中心').last);
    await tester.pumpAndSettle();
    expect(find.text('自动源健康巡检'), findsOneWidget);
    expect(find.byKey(const Key('source-health-probe')), findsOneWidget);

    await tester.tap(find.text('动漫').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('hub-search-bar-anime')));
    await tester.pumpAndSettle();
    expect(find.text('SEARCH:anime'), findsOneWidget);
  });
}
