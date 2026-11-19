import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import '../../../core/theme/app_theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../core/identity/media_identity.dart';
import '../../../core/playback/resume_target.dart';
import '../../../core/sandbox/local_plugin_runner.dart';
import '../../../core/router/app_router.dart';
import '../../../core/sources/local_sources.dart';
import '../../media/providers/media_providers.dart';
import '../../media/models/media_models.dart';
import '../../tracking/sync_provider.dart';

class MangaReaderScreen extends ConsumerStatefulWidget {
  final String pluginId;
  final String mediaId;
  final String chapterId;

  const MangaReaderScreen({
    super.key,
    required this.pluginId,
    required this.mediaId,
    required this.chapterId,
  });

  @override
  ConsumerState<MangaReaderScreen> createState() => _MangaReaderScreenState();
}

class _MangaReaderScreenState extends ConsumerState<MangaReaderScreen>
    with WidgetsBindingObserver {
  final TransformationController _transformationController = TransformationController();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final ScrollController _scrollController = ScrollController();
  final Map<int, GlobalKey> _pageKeys = {};
  final Map<int, int> _pageRetryCounts = {};

  late final String _mediaType;
  late final SyncService _syncService;
  String? _chapterTitle;
  int _currentPage = 0;
  int _pageCount = 0;
  int _restoredPage = 0;
  int _lastSavedPage = -1;
  final Set<String> _prefetchedUrls = {};
  List<String> _currentImages = const [];
  int? _anchorPage;
  bool _anchorQueued = false;
  bool _restored = false;
  bool _progressLoaded = false;
  bool _userScrolled = false;
  bool _disposed = false;

  MediaIdentity get _identity => MediaIdentity(
        pluginId: widget.pluginId,
        mediaType: _mediaType,
        mediaId: widget.mediaId,
      );

  @override
  void initState() {
    super.initState();
    _syncService = ref.read(syncServiceProvider);
    WidgetsBinding.instance.addObserver(this);
    _mediaType = resolveMediaType(
      types: ref.read(sourceByIdProvider(widget.pluginId))?.types,
      mediaId: widget.mediaId,
    );
    _scrollController.addListener(_onScroll);
    _loadSavedPage();
  }

  Future<void> _loadSavedPage() async {
    try {
      final saved = await ref.read(syncServiceProvider).loadProgress(_identity);
      if (!mounted || saved == null) return;
      if (!isSameChapter(saved.chapterId, widget.chapterId)) return;
      final page = saved.position;
      if (page != null && page > 0 && !_userScrolled) {
        setState(() {
          _restoredPage = page;
        });
      }
    } finally {
      _progressLoaded = true;
    }
  }

  bool _onScrollStart(ScrollStartNotification notification) {
    if (notification.dragDetails != null) {
      _releaseAnchor();
    }
    return false;
  }

  void _releaseAnchor() {
    _userScrolled = true;
    _anchorPage = null;
  }

  bool _onPageSizeChanged(SizeChangedLayoutNotification notification) {
    _queueAnchor();
    return false;
  }

  void _queueAnchor() {
    if (_anchorPage == null || _userScrolled || _anchorQueued) return;
    _anchorQueued = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _anchorQueued = false;
      _ensureAnchorVisible();
    });
  }

  Future<void> _ensureAnchorVisible() async {
    final target = _anchorPage;
    if (target == null || !mounted || _disposed || _userScrolled || !_scrollController.hasClients) return;
    final context = _pageKeys[target]?.currentContext;
    if (context != null) {
      await Scrollable.ensureVisible(
        context,
        duration: Duration.zero,
        alignment: 0.0,
      );
      return;
    }
    for (var page = target - 1; page >= 0; page--) {
      final box = _pageKeys[page]?.currentContext?.findRenderObject();
      if (box is! RenderBox || !box.attached) continue;
      final pageEnd = RenderAbstractViewport.of(box).getOffsetToReveal(box, 0.0).offset + box.size.height;
      _scrollController.jumpTo(pageEnd.clamp(0.0, _scrollController.position.maxScrollExtent));
      _queueAnchor();
      return;
    }
  }

  void _onScroll() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _disposed || !_scrollController.hasClients) return;
      if (_anchorPage != null && !_userScrolled) return;
      final page = _topVisiblePage();
      if (page == _currentPage) return;
      setState(() {
        _currentPage = page;
      });
      _prefetchAhead(page);
      _saveProgress();
    });
  }

  int _topVisiblePage() {
    final viewport = _scrollController.position.context.notificationContext?.findRenderObject();
    final viewportTop = viewport is RenderBox ? viewport.localToGlobal(Offset.zero).dy : 0.0;
    for (final entry in _pageKeys.entries) {
      final context = entry.value.currentContext;
      if (context == null) continue;
      final box = context.findRenderObject();
      if (box is! RenderBox || !box.attached) continue;
      final top = box.localToGlobal(Offset.zero).dy;
      final bottom = top + box.size.height;
      if (bottom > viewportTop && top <= viewportTop) return entry.key;
    }
    return _currentPage;
  }

  void _saveProgress() {
    if (_disposed || _pageCount == 0) return;
    if (!_userScrolled && (!_progressLoaded || (_restoredPage > 0 && !_restored))) return;
    if (_currentPage == _lastSavedPage) return;
    _lastSavedPage = _currentPage;
    try {
      _syncService.saveProgress(
            pluginId: widget.pluginId,
            mediaType: _mediaType,
            mediaId: widget.mediaId,
            chapterNo: 0,
            chapterId: widget.chapterId,
            chapterTitle: _chapterTitle,
            progress: _pageCount > 1 ? _currentPage / (_pageCount - 1) : 0.0,
            position: _currentPage,
          );
    } catch (_) {}
  }

  Future<void> _restoreScroll(int target) async {
    if (_restored) return;
    _restored = true;
    _anchorPage = target;
    for (var attempt = 0; attempt < 8; attempt++) {
      await Future<void>.delayed(const Duration(milliseconds: 60));
      if (!mounted || _userScrolled || !_scrollController.hasClients) break;
      if (_pageKeys[target]?.currentContext != null) {
        await _ensureAnchorVisible();
        if (mounted && !_userScrolled) {
          setState(() {
            _currentPage = target;
          });
        }
        return;
      }
      final max = _scrollController.position.maxScrollExtent;
      final estimated = (target * 400.0).clamp(0.0, max);
      if ((_scrollController.offset - estimated).abs() < 1) break;
      _scrollController.jumpTo(estimated);
    }
    _anchorPage = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      _saveProgress();
    }
  }

  @override
  void dispose() {
    _saveProgress();
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _transformationController.dispose();
    super.dispose();
  }

  void _resetZoom() {
    _transformationController.value = Matrix4.identity();
  }

  /// 预加载当前页后方的 3 页图片，减少翻页等待（参考 Mangayomi）。
  void _prefetchAhead(int fromPage) {
    if (!mounted || _disposed || _currentImages.isEmpty) return;
    final runner = ref.read(localPluginRunnerProvider);
    final end = (fromPage + 3).clamp(0, _currentImages.length - 1);
    for (var i = fromPage + 1; i <= end; i++) {
      final url = _currentImages[i];
      if (url.isEmpty || !_prefetchedUrls.add(url)) continue;
      final headers = runner.imageHeadersFor(widget.pluginId, url);
      precacheImage(
        CachedNetworkImageProvider(url, headers: headers),
        context,
        onError: (_, __) => _prefetchedUrls.remove(url),
      );
    }
  }

  Future<void> _retryPage(int index, String url) async {
    await CachedNetworkImage.evictFromCache(url);
    if (!mounted || _disposed) return;
    setState(() {
      _pageRetryCounts[index] = (_pageRetryCounts[index] ?? 0) + 1;
    });
  }

  @override
  Widget build(BuildContext context) {
    final imagesAsync = ref.watch(mangaPagesProvider((
      pluginId: widget.pluginId,
      chapterId: widget.chapterId
    )));
    final chaptersAsync = ref.watch(mediaChaptersProvider((
      pluginId: widget.pluginId,
      mediaId: widget.mediaId
    )));
    for (final chapter in chaptersAsync.value ?? <Chapter>[]) {
      if (chapter.id == widget.chapterId) {
        _chapterTitle = chapter.title;
        break;
      }
    }

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        _saveProgress();
        if (context.canPop()) {
          context.pop();
        }
      },
      child: Scaffold(
        key: _scaffoldKey,
        backgroundColor: Colors.black,
        endDrawer: _buildChaptersDrawer(chaptersAsync.value ?? []),
        appBar: AppBar(
          title: Text(
            _chapterTitle ?? '漫画阅读',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
          ),
          backgroundColor: Colors.transparent,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(LucideIcons.arrowLeft, color: Colors.white),
            tooltip: '返回',
            onPressed: () {
              _saveProgress();
              context.pop();
            },
          ),
          actions: [
            if (_pageCount > 0)
              Center(
                child: Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Text(
                    '${_currentPage + 1}/$_pageCount',
                    style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                  ),
                ),
              ),
            IconButton(
              icon: const Icon(LucideIcons.zoomOut, color: Colors.white),
              tooltip: '重置缩放',
              onPressed: _resetZoom,
            ),
            IconButton(
              icon: const Icon(LucideIcons.menu, color: Colors.white),
              tooltip: '章节列表',
              onPressed: () => _scaffoldKey.currentState?.openEndDrawer(),
            ),
          ],
        ),
        body: imagesAsync.when(
          data: (images) {
            if (images.isEmpty) {
              return const Center(
                child: Text(
                  '未解析到可用漫画图片。',
                  style: TextStyle(color: AppTheme.textSecondary),
                ),
              );
            }

            _pageCount = images.length;
            if (!identical(_currentImages, images)) {
              _currentImages = images;
              WidgetsBinding.instance.addPostFrameCallback((_) => _prefetchAhead(_currentPage));
            }
            final restoreTarget = restoredMangaPage(savedPage: _restoredPage, pageCount: images.length);
            if (restoreTarget != null && restoreTarget > 0 && !_restored && !_userScrolled) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                _restoreScroll(restoreTarget);
              });
            }

            return InteractiveViewer(
              transformationController: _transformationController,
              minScale: 1.0,
              maxScale: 4.0,
              onInteractionStart: (_) => _releaseAnchor(),
              child: NotificationListener<ScrollStartNotification>(
                onNotification: _onScrollStart,
                child: NotificationListener<SizeChangedLayoutNotification>(
                  onNotification: _onPageSizeChanged,
                  child: ListView.builder(
                  controller: _scrollController,
                  padding: EdgeInsets.only(top: 8, bottom: 8 + MediaQuery.paddingOf(context).bottom),
                  itemCount: images.length,
                  itemBuilder: (context, index) {
                    final key = _pageKeys.putIfAbsent(index, () => GlobalKey());
                    return SizeChangedLayoutNotifier(
                      child: Container(
                      key: key,
                      margin: const EdgeInsets.only(bottom: 8),
                      child: Column(
                        children: [
                          CachedNetworkImage(
                            key: (_pageRetryCounts[index] ?? 0) > 0
                                ? ValueKey('manga-page-$index-retry-${_pageRetryCounts[index]}')
                                : null,
                            imageUrl: images[index],
                            httpHeaders: ref.read(localPluginRunnerProvider).imageHeadersFor(widget.pluginId, images[index]),
                            fit: BoxFit.contain,
                            placeholder: (context, url) => Container(
                              height: 300,
                              color: AppTheme.surface,
                              child: const Center(
                                child: CircularProgressIndicator(color: AppTheme.primary),
                              ),
                            ),
                            errorWidget: (context, url, error) => GestureDetector(
                              onTap: () => _retryPage(index, url),
                              child: Container(
                                height: 200,
                                color: AppTheme.surface,
                                alignment: Alignment.center,
                                child: const Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(LucideIcons.refreshCw, color: AppTheme.textSecondary),
                                    SizedBox(height: 6),
                                    Text(
                                      '图片加载失败，点击重试',
                                      style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '${index + 1} / ${images.length}',
                            style: const TextStyle(
                              fontSize: 10,
                              color: AppTheme.textSecondary,
                              fontFamily: 'monospace',
                            ),
                          ),
                        ],
                      ),
                    ),
                    );
                  },
                ),
                ),
              ),
            );
          },
          loading: () => const Center(
            child: CircularProgressIndicator(color: AppTheme.primary),
          ),
          error: (err, _) => Center(
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(LucideIcons.circleAlert, size: 48, color: AppTheme.danger),
                  const SizedBox(height: 16),
                  Text(
                    '获取漫画图片失败: $err',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: () => context.pop(),
                    child: const Text('返回'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildChaptersDrawer(List<Chapter> chapters) {
    return Drawer(
      backgroundColor: AppTheme.surface, // Slate 900
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.all(16.0),
              child: Row(
                children: [
                  Icon(LucideIcons.bookOpen, color: AppTheme.primary, size: 20),
                  SizedBox(width: 8),
                  Text(
                    '章节跳转',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            ),
            const Divider(color: AppTheme.surfaceLight),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                itemCount: chapters.length,
                itemBuilder: (context, index) {
                  final ch = chapters[index];
                  final isCurrent = ch.id == widget.chapterId;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    decoration: BoxDecoration(
                      color: isCurrent ? AppTheme.primary.withOpacity(0.1) : Colors.transparent,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isCurrent ? AppTheme.primary.withOpacity(0.3) : Colors.transparent,
                      ),
                    ),
                    child: ListTile(
                      title: Text(
                        ch.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: isCurrent ? AppTheme.primary : AppTheme.textSecondary,
                          fontSize: 13,
                          fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                      onTap: () {
                        _saveProgress();
                        Navigator.of(context).pop();
                        context.pushReplacement(
                          readLocation(
                            route: 'manga-read',
                            pluginId: widget.pluginId,
                            mediaId: widget.mediaId,
                            chapterId: ch.id,
                          ),
                        );
                      },
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
