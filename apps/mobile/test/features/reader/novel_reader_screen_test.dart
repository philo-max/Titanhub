import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:titanhub/core/identity/media_identity.dart';
import 'package:titanhub/core/router/app_router.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/core/storage/app_database.dart';
import 'package:titanhub/features/media/models/media_models.dart';
import 'package:titanhub/features/media/providers/media_providers.dart';
import 'package:titanhub/features/reader/providers/novel_reader_prefs.dart';
import 'package:titanhub/features/reader/views/novel_reader_screen.dart';
import 'package:titanhub/features/tracking/sync_provider.dart';

class _RecordingSyncService implements SyncService {
  final List<({String? chapterId, double progress})> saves = [];

  @override
  Future<LocalTrackingData?> loadProgress(MediaIdentity identity) async => null;

  @override
  Future<void> saveProgress({
    required String pluginId,
    required String mediaType,
    required String mediaId,
    int chapterNo = 0,
    String? chapterId,
    String? chapterTitle,
    required double progress,
    int? position,
    String status = 'watching',
  }) async {
    saves.add((chapterId: chapterId, progress: progress));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  test('NovelReaderPrefsNotifier persists and reloads preferences from disk', () async {
    final tempDir = await Directory.systemTemp.createTemp('titanhub_novel_prefs_');
    addTearDown(() => tempDir.delete(recursive: true));

    final notifier = NovelReaderPrefsNotifier(
      directoryProvider: () async => tempDir,
      autoLoad: false,
    );
    notifier.setTheme(NovelTheme.sepia);
    notifier.setReadMode(NovelReadMode.paged);
    notifier.setFontSize(22.0);
    notifier.setLineHeight(2.1);
    notifier.setSerifFont(false);

    // Wait briefly for async file write
    await Future<void>.delayed(const Duration(milliseconds: 80));

    final reloaded = NovelReaderPrefsNotifier(
      directoryProvider: () async => tempDir,
      autoLoad: false,
    );
    await reloaded.load();
    expect(reloaded.state.theme, NovelTheme.sepia);
    expect(reloaded.state.readMode, NovelReadMode.paged);
    expect(reloaded.state.fontSize, 22.0);
    expect(reloaded.state.lineHeight, 2.1);
    expect(reloaded.state.serifFont, false);
  });

  testWidgets('failed chapter load does not overwrite saved progress on dispose', (tester) async {
    final sync = _RecordingSyncService();
    const pluginId = 'linovelib';
    const mediaId = '2906';
    const chapterId = '2906/bad';

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          syncServiceProvider.overrideWithValue(sync),
          localSourcesProvider.overrideWithValue(const [linovelibMediaSource]),
          mediaChaptersProvider((pluginId: pluginId, mediaId: mediaId))
              .overrideWith((ref) async => const <Chapter>[]),
          novelContentProvider((pluginId: pluginId, chapterId: chapterId))
              .overrideWith((ref) async => throw StateError('network failed')),
        ],
        child: const MaterialApp(
          home: NovelReaderScreen(
            pluginId: pluginId,
            mediaId: mediaId,
            chapterId: chapterId,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('抓取小说正文失败'), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);

    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    expect(sync.saves, isEmpty);
  });

  testWidgets('next chapter navigation preserves reading mode and font preferences',
      (tester) async {
    final sync = _RecordingSyncService();
    const pluginId = 'linovelib';
    const mediaId = '2906';
    final chapters = [
      Chapter(id: '2906/1', title: '第一章 序幕', chapterNo: 1),
      Chapter(id: '2906/2', title: '第二章 展开', chapterNo: 2),
    ];

    final router = GoRouter(
      initialLocation: readLocation(
        route: 'novel-read',
        pluginId: pluginId,
        mediaId: mediaId,
        chapterId: '2906/1',
      ),
      routes: [
        GoRoute(
          path: '/novel-read/:pluginId/:mediaId/:chapterId',
          builder: (_, state) => NovelReaderScreen(
            pluginId: state.pathParameters['pluginId']!,
            mediaId: state.pathParameters['mediaId']!,
            chapterId: state.pathParameters['chapterId']!,
          ),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          syncServiceProvider.overrideWithValue(sync),
          localSourcesProvider.overrideWithValue(const [linovelibMediaSource]),
          mediaChaptersProvider((pluginId: pluginId, mediaId: mediaId))
              .overrideWith((ref) async => chapters),
          novelContentProvider((pluginId: pluginId, chapterId: '2906/1'))
              .overrideWith((ref) async => '第一章第一段正文。\n\n第一章第二段正文。'),
          novelContentProvider((pluginId: pluginId, chapterId: '2906/2'))
              .overrideWith((ref) async => '第二章的正文内容。'),
          novelReaderPrefsProvider.overrideWith(
            (_) => NovelReaderPrefsNotifier(autoLoad: false),
          ),
        ],
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('第一章 序幕'), findsOneWidget);
    expect(find.byKey(const Key('novel-next-chapter')), findsOneWidget);

    // Open settings and switch to Paged mode + Sepia theme
    await tester.tap(find.byTooltip('阅读设置'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('左右翻页'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('SEP'));
    await tester.pumpAndSettle();
    // Close settings overlay
    await tester.tap(find.byTooltip('阅读设置'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('novel-paged-view')), findsOneWidget);

    // Navigate to Chapter 2 using the bottom Next Chapter button
    await tester.tap(find.byKey(const Key('novel-next-chapter')));
    await tester.pumpAndSettle();

    // Verify Chapter 2 loaded AND stayed in Paged mode!
    expect(find.text('第二章 展开'), findsOneWidget);
    expect(find.text('第二章的正文内容。'), findsOneWidget);
    expect(find.byKey(const Key('novel-paged-view')), findsOneWidget);
  });
}
