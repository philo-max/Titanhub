import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:titanhub/core/identity/media_identity.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/core/storage/app_database.dart';
import 'package:titanhub/features/media/models/media_models.dart';
import 'package:titanhub/features/media/providers/media_providers.dart';
import 'package:titanhub/features/reader/views/manga_reader_screen.dart';
import 'package:titanhub/features/reader/views/novel_reader_screen.dart';
import 'package:titanhub/features/tracking/sync_provider.dart';

const _pluginId = 'fixture-plugin';
const _mediaId = 'fixture-media';
const _chapterId = 'fixture-chapter';
const _pageCount = 10;

class _SavedProgress {
  _SavedProgress(this.progress, this.position);

  final double progress;
  final int? position;
}

class _FakeSyncService implements SyncService {
  final Completer<LocalTrackingData?> pendingLoad = Completer<LocalTrackingData?>();
  final List<_SavedProgress> saves = [];

  @override
  Future<LocalTrackingData?> loadProgress(MediaIdentity identity) => pendingLoad.future;

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
    saves.add(_SavedProgress(progress, position));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

LocalTrackingData _tracking({double progress = 0.0, int? position}) => LocalTrackingData(
      id: 'fixture',
      pluginId: _pluginId,
      mediaType: 'manga',
      mediaId: _mediaId,
      chapterNo: 0,
      chapterId: _chapterId,
      chapterTitle: _chapterId,
      progress: progress,
      position: position,
      status: 'watching',
      updatedAt: DateTime(2026),
    );

Widget _host(_FakeSyncService sync, Widget child) {
  const chapterArg = (pluginId: _pluginId, chapterId: _chapterId);
  return ProviderScope(
    overrides: [
      syncServiceProvider.overrideWithValue(sync),
      localSourcesProvider.overrideWithValue(const []),
      mediaChaptersProvider((pluginId: _pluginId, mediaId: _mediaId))
          .overrideWith((ref) async => const <Chapter>[]),
      mangaPagesProvider(chapterArg).overrideWith(
        (ref) async => List.generate(_pageCount, (i) => 'http://fixture.invalid/page-$i.png'),
      ),
      novelContentProvider(chapterArg).overrideWith(
        (ref) async => List.generate(200, (i) => 'Paragraph $i fixture text.').join('\n\n'),
      ),
    ],
    child: MaterialApp(home: child),
  );
}

ScrollPosition _position(WidgetTester tester) =>
    tester.state<ScrollableState>(find.byType(Scrollable).first).position;

Future<void> _pumpFrames(WidgetTester tester, {int count = 12}) async {
  for (var i = 0; i < count; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _userDrag(WidgetTester tester, Finder finder, double dy) async {
  final gesture = await tester.startGesture(tester.getCenter(finder));
  const steps = 10;
  for (var i = 0; i < steps; i++) {
    await gesture.moveBy(Offset(0, dy / steps));
    await tester.pump(const Duration(milliseconds: 16));
  }
  await gesture.up();
  await tester.pump();
}

class _ControlledImageCompleter extends ImageStreamCompleter {
  void emit(ui.Image image) => setImage(ImageInfo(image: image));
}

String _pageUrl(int index) => 'http://fixture.invalid/page-$index.png';

_ControlledImageCompleter _controlPage(int index) {
  final completer = _ControlledImageCompleter();
  PaintingBinding.instance.imageCache
    ..clear()
    ..clearLiveImages();
  final cached = PaintingBinding.instance.imageCache.putIfAbsent(
    CachedNetworkImageProvider(_pageUrl(index)),
    () => completer,
  );
  expect(cached, same(completer));
  return completer;
}

Future<void> _emitTallImage(WidgetTester tester, _ControlledImageCompleter completer) async {
  final image = await tester.runAsync(() => createTestImage(width: 800, height: 1200));
  completer.emit(image!);
}

Rect _pageRect(WidgetTester tester, int index) => tester.getRect(find.byWidgetPredicate(
      (widget) => widget is CachedNetworkImage && widget.imageUrl == _pageUrl(index),
      skipOffstage: false,
    ));

const _manga = MangaReaderScreen(pluginId: _pluginId, mediaId: _mediaId, chapterId: _chapterId);
const _novel = NovelReaderScreen(pluginId: _pluginId, mediaId: _mediaId, chapterId: _chapterId);

void main() {
  group('MangaReaderScreen restore timing', () {
    testWidgets('a large jump records the page visible below the toolbar', (tester) async {
      final sync = _FakeSyncService();
      await tester.pumpWidget(_host(sync, _manga));
      sync.pendingLoad.complete(null);
      await _pumpFrames(tester, count: 3);
      _position(tester).jumpTo(1600);
      await _pumpFrames(tester, count: 3);
      final viewportTop = tester.getRect(find.byType(ListView)).top;
      final visible = find.byType(CachedNetworkImage).evaluate().where((element) {
        final bounds = tester.getRect(find.byWidget(element.widget));
        return bounds.top <= viewportTop && bounds.bottom > viewportTop;
      }).single.widget as CachedNetworkImage;
      final expectedPage = int.parse(RegExp(r'page-(\d+)').firstMatch(visible.imageUrl)!.group(1)!);
      expect(expectedPage, greaterThan(0));
      expect(find.text('${expectedPage + 1} / $_pageCount'), findsOneWidget);
      expect(sync.saves, isNotEmpty);
      expect(sync.saves.last.position, expectedPage);
    });

    testWidgets('closing a newly opened chapter saves its first page', (tester) async {
      final sync = _FakeSyncService();
      await tester.pumpWidget(_host(sync, _manga));
      sync.pendingLoad.complete(null);
      await _pumpFrames(tester, count: 3);
      expect(sync.saves, isEmpty);
      await tester.pumpWidget(_host(sync, const SizedBox()));
      expect(sync.saves, hasLength(1));
      expect(sync.saves.single.position, 0);
    });

    testWidgets('late progress restores without user interaction after pages are ready', (tester) async {
      final sync = _FakeSyncService();
      await tester.pumpWidget(_host(sync, _manga));
      await _pumpFrames(tester, count: 3);

      expect(find.text('1 / $_pageCount'), findsOneWidget);
      expect(_position(tester).pixels, 0);
      expect(sync.saves, isEmpty);

      sync.pendingLoad.complete(_tracking(position: 5));
      await _pumpFrames(tester);

      expect(_position(tester).pixels, greaterThan(0));
      expect(find.text('1 / $_pageCount'), findsNothing);
      expect(find.text('6 / $_pageCount'), findsOneWidget);
      expect(sync.saves.where((s) => s.position == 0), isEmpty);
    });

    testWidgets('late progress does not pull back a reader who already scrolled', (tester) async {
      final sync = _FakeSyncService();
      await tester.pumpWidget(_host(sync, _manga));
      await _pumpFrames(tester, count: 3);

      await _userDrag(tester, find.byType(ListView), -400);
      await _pumpFrames(tester, count: 2);

      sync.pendingLoad.complete(_tracking(position: 8));
      await _pumpFrames(tester, count: 2);

      await _userDrag(tester, find.byType(ListView), -200);
      await _pumpFrames(tester, count: 2);
      final afterUserScroll = _position(tester).pixels;
      await _pumpFrames(tester);

      expect(_position(tester).pixels, afterUserScroll);
      expect(find.text('9 / $_pageCount'), findsNothing);
      expect(sync.saves, isNotEmpty);
      expect(sync.saves.where((s) => s.position == 8), isEmpty);
    });

    testWidgets('restored page stays at the viewport top when an earlier image grows', (tester) async {
      final sync = _FakeSyncService();
      final previousPage = _controlPage(6);
      await tester.pumpWidget(_host(sync, _manga));
      sync.pendingLoad.complete(_tracking(position: 7));
      await _pumpFrames(tester);

      final viewportTop = tester.getRect(find.byType(ListView)).top;
      expect(_pageRect(tester, 7).top, closeTo(viewportTop, 1));
      expect(_pageRect(tester, 6).height, lessThan(400));

      await _emitTallImage(tester, previousPage);
      await _pumpFrames(tester);

      expect(_pageRect(tester, 6).height, greaterThan(1000));
      expect(_pageRect(tester, 7).top, closeTo(viewportTop, 1));
      expect(find.text('8/$_pageCount'), findsOneWidget);
      await tester.pumpWidget(_host(sync, const SizedBox()));
      expect(sync.saves, isNotEmpty);
      expect(sync.saves.where((s) => s.position != 7), isEmpty);
    });

    testWidgets('earlier image growth after a user drag does not pull the reader back', (tester) async {
      final sync = _FakeSyncService();
      final previousPage = _controlPage(6);
      await tester.pumpWidget(_host(sync, _manga));
      sync.pendingLoad.complete(_tracking(position: 7));
      await _pumpFrames(tester);

      await _userDrag(tester, find.byType(ListView), 150);
      await _pumpFrames(tester, count: 3);
      final afterUserScroll = _position(tester).pixels;

      await _emitTallImage(tester, previousPage);
      await _pumpFrames(tester);

      expect(_pageRect(tester, 6).height, greaterThan(1000));
      expect(_position(tester).pixels, afterUserScroll);
      expect(find.text('8/$_pageCount'), findsNothing);
    });

    testWidgets('backgrounding and disposing before progress loads neither saves page 0 nor setStates later', (tester) async {
      final sync = _FakeSyncService();
      await tester.pumpWidget(_host(sync, _manga));
      await _pumpFrames(tester, count: 3);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pumpWidget(_host(sync, const SizedBox()));
      sync.pendingLoad.complete(_tracking(position: 5));
      await _pumpFrames(tester, count: 3);

      expect(tester.takeException(), isNull);
      expect(sync.saves, isEmpty);
    });
  });

  group('NovelReaderScreen restore timing', () {
    testWidgets('closing a newly opened chapter saves its initial position', (tester) async {
      final sync = _FakeSyncService();
      await tester.pumpWidget(_host(sync, _novel));
      sync.pendingLoad.complete(null);
      await _pumpFrames(tester, count: 3);
      expect(sync.saves, isEmpty);
      await tester.pumpWidget(_host(sync, const SizedBox()));
      expect(sync.saves, hasLength(1));
      expect(sync.saves.single.progress, 0);
    });

    testWidgets('late progress restores without user interaction after content is ready', (tester) async {
      final sync = _FakeSyncService();
      await tester.pumpWidget(_host(sync, _novel));
      await _pumpFrames(tester, count: 3);

      expect(_position(tester).pixels, 0);

      sync.pendingLoad.complete(_tracking(progress: 0.5));
      await _pumpFrames(tester, count: 3);

      final position = _position(tester);
      expect(position.pixels, closeTo(position.maxScrollExtent * 0.5, 1));
    });

    testWidgets('late progress does not jump a reader who already scrolled', (tester) async {
      final sync = _FakeSyncService();
      await tester.pumpWidget(_host(sync, _novel));
      await _pumpFrames(tester, count: 3);

      await _userDrag(tester, find.byType(SingleChildScrollView), -300);
      await _pumpFrames(tester, count: 3);
      final afterUserScroll = _position(tester).pixels;

      sync.pendingLoad.complete(_tracking(progress: 0.9));
      await _pumpFrames(tester, count: 3);

      expect(_position(tester).pixels, afterUserScroll);
    });

    testWidgets('backgrounding and disposing before progress loads does not save 0', (tester) async {
      final sync = _FakeSyncService();
      await tester.pumpWidget(_host(sync, _novel));
      await _pumpFrames(tester, count: 3);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pumpWidget(_host(sync, const SizedBox()));
      sync.pendingLoad.complete(_tracking(progress: 0.5));
      await _pumpFrames(tester, count: 3);

      expect(tester.takeException(), isNull);
      expect(sync.saves, isEmpty);
    });
  });
}
