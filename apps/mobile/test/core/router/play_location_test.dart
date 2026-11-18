import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:titanhub/core/router/app_router.dart';

Future<Map<String, String?>> _navigate(WidgetTester tester, String location) async {
  final captured = <String, String?>{};
  final router = GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(path: '/', builder: (context, state) => const SizedBox()),
      GoRoute(
        path: '/play/:pluginId/:mediaId/:chapterId',
        builder: (context, state) {
          captured
            ..['pluginId'] = state.pathParameters['pluginId']
            ..['mediaId'] = state.pathParameters['mediaId']
            ..['chapterId'] = state.pathParameters['chapterId']
            ..['groupId'] = state.uri.queryParameters['groupId'];
          return const SizedBox();
        },
      ),
    ],
  );
  await tester.pumpWidget(MaterialApp.router(routerConfig: router));
  router.go(location);
  await tester.pumpAndSettle();
  return captured;
}

void main() {
  testWidgets('来源原始ID（含%2F和斜杠）经路由后保持不变', (tester) async {
    final params = await _navigate(
      tester,
      playLocation(
        pluginId: 'kazumi-7sefun',
        mediaId: '%2Fvoddetail%2F123.html',
        chapterId: '/play/123-2-1001.html',
        groupId: 'line-2',
      ),
    );

    expect(params['pluginId'], 'kazumi-7sefun');
    expect(params['mediaId'], '%2Fvoddetail%2F123.html');
    expect(params['chapterId'], '/play/123-2-1001.html');
    expect(params['groupId'], 'line-2');
  });

  testWidgets('无线路上下文时不附带查询参数', (tester) async {
    final params = await _navigate(
      tester,
      playLocation(pluginId: 'p', mediaId: 'm', chapterId: 'c?x=1&y', groupId: ''),
    );
    expect(params['chapterId'], 'c?x=1&y');
    expect(params['groupId'], isNull);
  });

  testWidgets('阅读页路径里带斜杠的作品ID与章节ID经路由后保持不变', (tester) async {
    final captured = <String, String?>{};
    final router = GoRouter(
      initialLocation: '/',
      routes: [
        GoRoute(path: '/', builder: (context, state) => const SizedBox()),
        GoRoute(
          path: '/manga-read/:pluginId/:mediaId/:chapterId',
          builder: (context, state) {
            captured
              ..['pluginId'] = state.pathParameters['pluginId']
              ..['mediaId'] = state.pathParameters['mediaId']
              ..['chapterId'] = state.pathParameters['chapterId'];
            return const SizedBox();
          },
        ),
      ],
    );
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    router.go(readLocation(
      route: 'manga-read',
      pluginId: 'venera-goda',
      mediaId: '/manga/yijinanoneyuanzuoban-one',
      chapterId: '/manga/yijinanoneyuanzuoban-one/1',
    ));
    await tester.pumpAndSettle();

    expect(captured['pluginId'], 'venera-goda');
    expect(captured['mediaId'], '/manga/yijinanoneyuanzuoban-one');
    expect(captured['chapterId'], '/manga/yijinanoneyuanzuoban-one/1');
  });
}
