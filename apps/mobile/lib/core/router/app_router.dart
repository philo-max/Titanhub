import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/home/views/main_shell_screen.dart';
import '../../features/search/views/search_screen.dart';
import '../sources/local_sources.dart';
import '../../features/media/views/detail_screen.dart';
import '../../features/player/views/player_screen.dart';
import '../../features/reader/views/manga_reader_screen.dart';
import '../../features/reader/views/novel_reader_screen.dart';
import '../../features/sources/source_config_screen.dart';
import '../../features/sources/source_hub_screen.dart';
import '../../features/sources/source_settings_screen.dart';
import '../sources/unified/source_kind.dart';
import '../../features/tracking/webdav_settings_screen.dart';

String playLocation({
  required String pluginId,
  required String mediaId,
  required String chapterId,
  String? groupId,
}) {
  final path = '/play/${Uri.encodeComponent(pluginId)}/${Uri.encodeComponent(mediaId)}'
      '/${Uri.encodeComponent(chapterId)}';
  if (groupId == null || groupId.isEmpty) return path;
  return '$path?groupId=${Uri.encodeQueryComponent(groupId)}';
}

String readLocation({
  required String route,
  required String pluginId,
  required String mediaId,
  required String chapterId,
}) =>
    '/$route/${Uri.encodeComponent(pluginId)}/${Uri.encodeComponent(mediaId)}'
    '/${Uri.encodeComponent(chapterId)}';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const MainShellScreen(),
      ),
      GoRoute(
        path: '/search',
        builder: (context, state) {
          final qp = state.uri.queryParameters;
          final typeName = qp['type'];
          MediaTypeFilter? initialType;
          if (typeName != null) {
            for (final f in MediaTypeFilter.values) {
              if (f.name == typeName) {
                initialType = f;
                break;
              }
            }
          }
          return SearchScreen(
            initialType: initialType,
            initialQuery: qp['q'],
            initialSourceId: qp['source'],
          );
        },
      ),
      GoRoute(
        path: '/sources',
        builder: (context, state) => const SourceHubScreen(),
      ),
      GoRoute(
        path: '/sources/:kind',
        redirect: (context, state) {
          final kind = SourceKind.fromSlug(state.pathParameters['kind'] ?? '');
          return kind != null && kind.available ? null : '/sources';
        },
        builder: (context, state) =>
            SourceConfigScreen(kind: SourceKind.fromSlug(state.pathParameters['kind'] ?? '')!),
      ),
      GoRoute(
        path: '/sources/:kind/:pluginId/settings',
        builder: (context, state) =>
            SourceSettingsScreen(pluginId: state.pathParameters['pluginId'] ?? ''),
      ),
      GoRoute(
        path: '/webdav',
        builder: (context, state) => const WebDavSettingsScreen(),
      ),
      GoRoute(
        path: '/detail/:pluginId/:mediaId',
        builder: (context, state) {
          final pluginId = state.pathParameters['pluginId'] ?? '';
          final mediaId = state.pathParameters['mediaId'] ?? '';
          return DetailScreen(pluginId: pluginId, mediaId: mediaId);
        },
      ),
      GoRoute(
        path: '/play/:pluginId/:mediaId/:chapterId',
        builder: (context, state) {
          final pluginId = state.pathParameters['pluginId'] ?? '';
          final mediaId = state.pathParameters['mediaId'] ?? '';
          final chapterId = state.pathParameters['chapterId'] ?? '';
          final query = state.uri.queryParameters;
          return PlayerScreen(
            pluginId: pluginId,
            mediaId: mediaId,
            chapterId: chapterId,
            groupId: query['groupId'] ?? query['lineId'],
            startFullscreen: identical(state.extra, playerFullscreenExtra),
          );
        },
      ),
      GoRoute(
        path: '/manga-read/:pluginId/:mediaId/:chapterId',
        builder: (context, state) {
          final pluginId = state.pathParameters['pluginId'] ?? '';
          final mediaId = state.pathParameters['mediaId'] ?? '';
          final chapterId = state.pathParameters['chapterId'] ?? '';
          return MangaReaderScreen(
            pluginId: pluginId,
            mediaId: mediaId,
            chapterId: chapterId,
          );
        },
      ),
      GoRoute(
        path: '/novel-read/:pluginId/:mediaId/:chapterId',
        builder: (context, state) {
          final pluginId = state.pathParameters['pluginId'] ?? '';
          final mediaId = state.pathParameters['mediaId'] ?? '';
          final chapterId = state.pathParameters['chapterId'] ?? '';
          return NovelReaderScreen(
            pluginId: pluginId,
            mediaId: mediaId,
            chapterId: chapterId,
          );
        },
      ),
    ],
  );
});
