import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/search/views/search_screen.dart';
import '../../features/media/views/detail_screen.dart';
import '../../features/player/views/player_screen.dart';
import '../../features/reader/views/manga_reader_screen.dart';
import '../../features/reader/views/novel_reader_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const SearchScreen(),
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
          return PlayerScreen(
            pluginId: pluginId,
            mediaId: mediaId,
            chapterId: chapterId,
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
