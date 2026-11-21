import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../core/identity/media_identity.dart';
import '../../../core/playback/resume_target.dart';
import '../../../core/router/app_router.dart';
import '../../../core/sources/local_sources.dart';
import '../../../core/theme/app_theme.dart';
import '../../media/models/media_models.dart';
import '../../media/providers/media_providers.dart';
import '../../tracking/sync_provider.dart';
import '../providers/novel_reader_prefs.dart';

export '../providers/novel_reader_prefs.dart' show NovelReadMode, NovelTheme;

class NovelReaderScreen extends ConsumerStatefulWidget {
  final String pluginId;
  final String mediaId;
  final String chapterId;

  const NovelReaderScreen({
    super.key,
    required this.pluginId,
    required this.mediaId,
    required this.chapterId,
  });

  @override
  ConsumerState<NovelReaderScreen> createState() => _NovelReaderScreenState();
}

class _NovelReaderScreenState extends ConsumerState<NovelReaderScreen>
    with WidgetsBindingObserver {
  bool _settingsVisible = false;
  int _currentPage = 0;
  int _lastPageCount = 1;
  NovelReadMode _lastReadMode = NovelReadMode.scroll;

  final ScrollController _scrollController = ScrollController();
  final PageController _pageController = PageController();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  late final String _mediaType;
  late final SyncService _syncService;
  String? _chapterTitle;
  double _restoredProgress = 0.0;
  double _lastSavedProgress = -1.0;
  double? _pendingRatioJump;
  bool _contentLoaded = false;
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
    _loadSavedProgress();
  }

  Future<void> _loadSavedProgress() async {
    try {
      final saved = await ref.read(syncServiceProvider).loadProgress(_identity);
      if (!mounted || saved == null) return;
      if (!isSameChapter(saved.chapterId, widget.chapterId)) return;
      final progress = restoredNovelProgress(saved.progress);
      if (progress > 0 && !_userScrolled) {
        setState(() {
          _restoredProgress = progress;
        });
      }
    } finally {
      _progressLoaded = true;
    }
  }

  bool _onScrollStart(ScrollStartNotification notification) {
    if (notification.dragDetails != null) {
      _userScrolled = true;
    }
    return false;
  }

  void _restoreScroll() {
    final pending = _pendingRatioJump;
    if (pending != null) {
      _pendingRatioJump = null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_scrollController.hasClients) return;
        final max = _scrollController.position.maxScrollExtent;
        if (max > 0) {
          _scrollController.jumpTo((pending * max).clamp(0.0, max));
        }
      });
      return;
    }
    if (_restored || _userScrolled || _restoredProgress <= 0) return;
    _restored = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _userScrolled || !_scrollController.hasClients) return;
      final max = _scrollController.position.maxScrollExtent;
      _scrollController.jumpTo((_restoredProgress * max).clamp(0.0, max));
    });
  }

  void _restorePagedPosition(int pageCount) {
    if (pageCount <= 0) return;
    final pending = _pendingRatioJump;
    if (pending != null) {
      _pendingRatioJump = null;
      final target = pageCount <= 1 ? 0 : (pending * (pageCount - 1)).round().clamp(0, pageCount - 1);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_pageController.hasClients) return;
        _pageController.jumpToPage(target);
        if (mounted && _currentPage != target) {
          setState(() => _currentPage = target);
        }
      });
      return;
    }
    if (_restored || _userScrolled || _restoredProgress <= 0) return;
    _restored = true;
    final target = pageCount <= 1 ? 0 : (_restoredProgress * (pageCount - 1)).round().clamp(0, pageCount - 1);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _userScrolled || !_pageController.hasClients) return;
      _pageController.jumpToPage(target);
      if (mounted && _currentPage != target) {
        setState(() => _currentPage = target);
      }
    });
  }

  double _currentReadingRatio(NovelReadMode mode) {
    if (mode == NovelReadMode.paged) {
      if (_lastPageCount <= 1) return _lastSavedProgress < 0 ? 0.0 : _lastSavedProgress.clamp(0.0, 1.0);
      return (_currentPage / (_lastPageCount - 1)).clamp(0.0, 1.0);
    }
    if (_scrollController.hasClients) {
      final maxScroll = _scrollController.position.maxScrollExtent;
      if (maxScroll > 0) {
        return (_scrollController.offset / maxScroll).clamp(0.0, 1.0);
      }
    }
    return _lastSavedProgress < 0 ? 0.0 : _lastSavedProgress.clamp(0.0, 1.0);
  }

  void _onScroll() {
    if (!_scrollController.hasClients || !_contentLoaded) return;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.offset;
    if (maxScroll <= 0 || currentScroll <= 0) return;
    final progress = (currentScroll / maxScroll).clamp(0.0, 1.0);
    if ((progress - _lastSavedProgress).abs() < 0.01) return;
    _persistProgress(progress);
  }

  void _saveProgress() {
    if (_disposed || !_contentLoaded) return;
    if (!_userScrolled && (!_progressLoaded || (_restoredProgress > 0 && !_restored))) return;
    if (_lastReadMode == NovelReadMode.paged) {
      final ratio = _lastPageCount <= 1
          ? (_lastSavedProgress < 0 ? 0.0 : _lastSavedProgress.clamp(0.0, 1.0))
          : (_currentPage / (_lastPageCount - 1)).clamp(0.0, 1.0);
      _persistProgress(ratio);
      return;
    }
    if (_scrollController.hasClients) {
      final maxScroll = _scrollController.position.maxScrollExtent;
      if (maxScroll > 0) {
        _persistProgress((_scrollController.offset / maxScroll).clamp(0.0, 1.0));
        return;
      }
    }
    _persistProgress(_lastSavedProgress < 0 ? 0.0 : _lastSavedProgress.clamp(0.0, 1.0));
  }

  void _persistProgress(double progress) {
    _lastSavedProgress = progress;
    try {
      _syncService.saveProgress(
        pluginId: widget.pluginId,
        mediaType: _mediaType,
        mediaId: widget.mediaId,
        chapterNo: 0,
        chapterId: widget.chapterId,
        chapterTitle: _chapterTitle,
        progress: progress,
      );
    } catch (_) {}
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      _saveProgress();
    }
  }

  void _savePagedProgress(double progress) {
    if (_disposed || !_contentLoaded) return;
    final clamped = progress.clamp(0.0, 1.0);
    if ((clamped - _lastSavedProgress).abs() < 0.05 && clamped < 1.0) return;
    _persistProgress(clamped);
  }

  void _openChapter(Chapter chapter) {
    _saveProgress();
    context.pushReplacement(
      readLocation(
        route: 'novel-read',
        pluginId: widget.pluginId,
        mediaId: widget.mediaId,
        chapterId: chapter.id,
      ),
    );
  }

  static bool _isImageToken(String block) {
    final trimmed = block.trim();
    return trimmed.startsWith('[IMG:') && trimmed.endsWith(']') && trimmed.length > 6;
  }

  static String _extractImageUrl(String block) {
    final trimmed = block.trim();
    return trimmed.substring(5, trimmed.length - 1).trim();
  }

  List<List<String>> _paginateParagraphs(
    List<String> paragraphs, {
    required double fontSize,
    required double lineHeight,
    required double availWidth,
    required double availHeight,
  }) {
    final safeWidth = availWidth.clamp(160.0, 960.0);
    final safeHeight = availHeight.clamp(200.0, 1600.0);
    final charsPerLine = (safeWidth / (fontSize * 1.04)).floor().clamp(10, 48);
    final linesPerPage = (safeHeight / (fontSize * lineHeight)).floor().clamp(6, 42);
    final maxCharsPerBlock = (charsPerLine * (linesPerPage - 1).clamp(3, 40)).clamp(60, 1400);

    // Split overly long single paragraphs so no single page overflows the viewport
    final normalized = <String>[];
    for (final raw in paragraphs) {
      final p = raw.trim();
      if (p.isEmpty) continue;
      if (_isImageToken(p) || p.length <= maxCharsPerBlock) {
        normalized.add(p);
      } else {
        for (var start = 0; start < p.length; start += maxCharsPerBlock) {
          final end = (start + maxCharsPerBlock).clamp(0, p.length);
          normalized.add(p.substring(start, end));
        }
      }
    }

    final pages = <List<String>>[];
    var current = <String>[];
    var usedLines = 0;
    final imgLines = (linesPerPage * 0.68).round().clamp(4, linesPerPage);

    for (final block in normalized) {
      final blockLines = _isImageToken(block)
          ? imgLines
          : ((block.length / charsPerLine).ceil().clamp(1, linesPerPage) + 1);
      if (current.isNotEmpty && usedLines + blockLines > linesPerPage) {
        pages.add(current);
        current = <String>[];
        usedLines = 0;
      }
      current.add(block);
      usedLines += blockLines;
    }
    if (current.isNotEmpty) pages.add(current);
    return pages.isEmpty ? [paragraphs] : pages;
  }

  @override
  void dispose() {
    _saveProgress();
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _pageController.dispose();
    super.dispose();
  }

  Map<NovelTheme, _ThemeConfig> get _themeConfigs => {
        NovelTheme.obsidian: const _ThemeConfig(
          bg: AppTheme.background,
          text: Color(0xFFE2E8F0),
          card: Color(0xFF0F172A),
          border: AppTheme.surfaceLight,
        ),
        NovelTheme.sepia: const _ThemeConfig(
          bg: Color(0xFFFBF0D9),
          text: Color(0xFF5F4625),
          card: Color(0xFFF4E3C1),
          border: Color(0xFFE8CE9D),
        ),
        NovelTheme.mint: const _ThemeConfig(
          bg: Color(0xFFDFF0D8),
          text: Color(0xFF2D5337),
          card: Color(0xFFD0E9C6),
          border: Color(0xFFBCDDB3),
        ),
        NovelTheme.light: const _ThemeConfig(
          bg: Color(0xFFFFFFFF),
          text: AppTheme.surfaceLight,
          card: Color(0xFFF8FAFC),
          border: Color(0xFFE2E8F0),
        ),
      };

  Widget _buildContentBlock(String block, _ThemeConfig config, NovelReaderPrefs prefs) {
    if (_isImageToken(block)) {
      final url = _extractImageUrl(block);
      return Padding(
        padding: const EdgeInsets.only(bottom: 16.0),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: CachedNetworkImage(
            imageUrl: url,
            httpHeaders: const {'Referer': 'https://www.linovelib.com/'},
            fit: BoxFit.contain,
            placeholder: (_, __) => Container(
              height: 220,
              color: config.card,
              alignment: Alignment.center,
              child: const CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primary),
            ),
            errorWidget: (_, __, ___) => Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: config.card,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: config.border),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(LucideIcons.imageOff, size: 16, color: config.text.withValues(alpha: 0.65)),
                  const SizedBox(width: 8),
                  Text('插图加载失败', style: TextStyle(color: config.text.withValues(alpha: 0.7), fontSize: 12)),
                ],
              ),
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Text(
        block.trim(),
        textAlign: TextAlign.justify,
        style: TextStyle(
          color: config.text,
          fontSize: prefs.fontSize,
          fontFamily: prefs.serifFont ? 'serif' : 'sans-serif',
          height: prefs.lineHeight,
        ),
      ),
    );
  }

  Widget _buildChapterNavBar({
    required _ThemeConfig config,
    required Chapter? prevChapter,
    required Chapter? nextChapter,
    bool inOverlay = false,
  }) {
    final fg = inOverlay ? Colors.white : config.text;
    final bg = inOverlay ? AppTheme.background : config.card;
    final border = inOverlay ? AppTheme.surfaceLight : config.border;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: border),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextButton.icon(
              key: inOverlay ? null : const Key('novel-prev-chapter'),
              onPressed: prevChapter == null ? null : () => _openChapter(prevChapter),
              icon: Icon(LucideIcons.chevronLeft, size: 15, color: prevChapter == null ? fg.withValues(alpha: 0.3) : fg),
              label: Text(
                '上一章',
                style: TextStyle(
                  fontSize: 12,
                  color: prevChapter == null ? fg.withValues(alpha: 0.3) : fg,
                ),
              ),
            ),
          ),
          TextButton.icon(
            key: inOverlay ? null : const Key('novel-open-toc'),
            onPressed: () {
              if (inOverlay) {
                setState(() => _settingsVisible = false);
              }
              _scaffoldKey.currentState?.openEndDrawer();
            },
            icon: Icon(LucideIcons.list, size: 15, color: AppTheme.primary),
            label: const Text('目录', style: TextStyle(fontSize: 12, color: AppTheme.primary)),
          ),
          Expanded(
            child: TextButton.icon(
              key: inOverlay ? null : const Key('novel-next-chapter'),
              onPressed: nextChapter == null ? null : () => _openChapter(nextChapter),
              icon: Icon(LucideIcons.chevronRight, size: 15, color: nextChapter == null ? fg.withValues(alpha: 0.3) : fg),
              label: Text(
                '下一章',
                style: TextStyle(
                  fontSize: 12,
                  color: nextChapter == null ? fg.withValues(alpha: 0.3) : fg,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final prefs = ref.watch(novelReaderPrefsProvider);
    _lastReadMode = prefs.readMode;
    final prefsNotifier = ref.read(novelReaderPrefsProvider.notifier);

    final contentArg = (pluginId: widget.pluginId, chapterId: widget.chapterId);
    final contentAsync = ref.watch(novelContentProvider(contentArg));
    final chaptersAsync = ref.watch(mediaChaptersProvider((
      pluginId: widget.pluginId,
      mediaId: widget.mediaId,
    )));
    final chapters = chaptersAsync.value ?? const <Chapter>[];
    var currentChapterIndex = -1;
    for (var i = 0; i < chapters.length; i++) {
      if (chapters[i].id == widget.chapterId) {
        _chapterTitle = chapters[i].title;
        currentChapterIndex = i;
        break;
      }
    }
    final prevChapter = currentChapterIndex > 0 ? chapters[currentChapterIndex - 1] : null;
    final nextChapter =
        (currentChapterIndex >= 0 && currentChapterIndex + 1 < chapters.length)
            ? chapters[currentChapterIndex + 1]
            : null;

    final config = _themeConfigs[prefs.theme]!;

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
        backgroundColor: config.bg,
        endDrawer: _buildChaptersDrawer(chapters, currentChapterIndex),
        appBar: AppBar(
          title: Text(
            _chapterTitle ?? '小说阅读',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: config.text,
            ),
          ),
          backgroundColor: Colors.transparent,
          elevation: 0,
          leading: IconButton(
            icon: Icon(LucideIcons.arrowLeft, color: config.text),
            tooltip: '返回',
            onPressed: () {
              _saveProgress();
              context.pop();
            },
          ),
          actions: [
            IconButton(
              icon: Icon(LucideIcons.type, color: config.text),
              tooltip: '阅读设置',
              onPressed: () {
                setState(() {
                  _settingsVisible = !_settingsVisible;
                });
              },
            ),
            IconButton(
              icon: Icon(LucideIcons.menu, color: config.text),
              tooltip: '章节目录',
              onPressed: () => _scaffoldKey.currentState?.openEndDrawer(),
            ),
          ],
        ),
        body: Stack(
          children: [
            contentAsync.when(
              data: (content) {
                if (content.trim().isEmpty) {
                  _contentLoaded = false;
                  return const Center(
                    child: Text('未解析出小说正文内容。', style: TextStyle(color: AppTheme.textSecondary)),
                  );
                }
                _contentLoaded = true;

                final paragraphs = content
                    .split('\n\n')
                    .where((p) => p.trim().isNotEmpty)
                    .toList();

                if (prefs.readMode == NovelReadMode.paged) {
                  return LayoutBuilder(
                    builder: (context, constraints) {
                      final bottomPad = MediaQuery.paddingOf(context).bottom;
                      final pages = _paginateParagraphs(
                        paragraphs,
                        fontSize: prefs.fontSize,
                        lineHeight: prefs.lineHeight,
                        availWidth: constraints.maxWidth - 44,
                        availHeight: constraints.maxHeight - 88 - bottomPad,
                      );
                      _lastPageCount = pages.length;
                      final safePage = _currentPage.clamp(0, pages.length - 1);
                      _restorePagedPosition(pages.length);

                      return Stack(
                        children: [
                          GestureDetector(
                            behavior: HitTestBehavior.translucent,
                            onTapUp: (details) {
                              final width = constraints.maxWidth;
                              final dx = details.localPosition.dx;
                              if (dx < width / 3) {
                                if (safePage > 0) {
                                  _userScrolled = true;
                                  _pageController.previousPage(
                                    duration: const Duration(milliseconds: 220),
                                    curve: Curves.easeOut,
                                  );
                                } else if (prevChapter != null) {
                                  _openChapter(prevChapter);
                                }
                              } else if (dx > width * 2 / 3) {
                                if (safePage < pages.length - 1) {
                                  _userScrolled = true;
                                  _pageController.nextPage(
                                    duration: const Duration(milliseconds: 220),
                                    curve: Curves.easeOut,
                                  );
                                } else if (nextChapter != null) {
                                  _openChapter(nextChapter);
                                }
                              } else {
                                setState(() => _settingsVisible = !_settingsVisible);
                              }
                            },
                            child: PageView.builder(
                              key: const Key('novel-paged-view'),
                              controller: _pageController,
                              itemCount: pages.length,
                              onPageChanged: (index) {
                                _userScrolled = true;
                                setState(() => _currentPage = index);
                                final ratio =
                                    pages.length <= 1 ? 1.0 : index / (pages.length - 1);
                                _savePagedProgress(ratio);
                              },
                              itemBuilder: (context, index) {
                                final isLastPage = index == pages.length - 1;
                                return SingleChildScrollView(
                                  padding: EdgeInsets.fromLTRB(
                                    22,
                                    16,
                                    22,
                                    60 + bottomPad,
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      for (final block in pages[index])
                                        _buildContentBlock(block, config, prefs),
                                      if (isLastPage && chapters.isNotEmpty) ...[
                                        const SizedBox(height: 16),
                                        _buildChapterNavBar(
                                          config: config,
                                          prevChapter: prevChapter,
                                          nextChapter: nextChapter,
                                        ),
                                      ],
                                    ],
                                  ),
                                );
                              },
                            ),
                          ),
                          Positioned(
                            left: 0,
                            right: 0,
                            bottom: 12 + bottomPad,
                            child: Center(
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.35),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Text(
                                  '第 ${safePage + 1} / ${pages.length} 页 · 点两侧翻页 / 中间设置',
                                  style: TextStyle(
                                    color: config.text.withValues(alpha: 0.75),
                                    fontSize: 11,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                  );
                }

                _restoreScroll();

                return NotificationListener<ScrollStartNotification>(
                  onNotification: _onScrollStart,
                  child: SingleChildScrollView(
                    controller: _scrollController,
                    padding: EdgeInsets.fromLTRB(
                      20,
                      16,
                      20,
                      120 + MediaQuery.paddingOf(context).bottom,
                    ),
                    child: SelectionArea(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final block in paragraphs)
                            _buildContentBlock(block, config, prefs),
                          if (chapters.isNotEmpty) ...[
                            const SizedBox(height: 20),
                            _buildChapterNavBar(
                              config: config,
                              prevChapter: prevChapter,
                              nextChapter: nextChapter,
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                );
              },
              loading: () {
                _contentLoaded = false;
                return const Center(
                  child: CircularProgressIndicator(color: AppTheme.primary),
                );
              },
              error: (err, _) {
                _contentLoaded = false;
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24.0),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(LucideIcons.octagonAlert, size: 48, color: AppTheme.danger),
                        const SizedBox(height: 16),
                        Text(
                          '抓取小说正文失败: $err',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: config.text),
                        ),
                        const SizedBox(height: 24),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            OutlinedButton(
                              onPressed: () => context.pop(),
                              child: const Text('返回'),
                            ),
                            const SizedBox(width: 12),
                            FilledButton.icon(
                              onPressed: () => ref.invalidate(novelContentProvider(contentArg)),
                              icon: const Icon(LucideIcons.refreshCw, size: 16),
                              label: const Text('重试'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),

            if (_settingsVisible)
              Positioned(
                left: 16,
                right: 16,
                bottom: 16 + MediaQuery.paddingOf(context).bottom,
                child: Material(
                  color: AppTheme.surface,
                  elevation: 10,
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppTheme.surfaceLight),
                    ),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        maxHeight: MediaQuery.sizeOf(context).height * 0.65,
                      ),
                      child: SingleChildScrollView(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (chapters.isNotEmpty) ...[
                              _buildChapterNavBar(
                                config: config,
                                prevChapter: prevChapter,
                                nextChapter: nextChapter,
                                inOverlay: true,
                              ),
                              const Divider(color: AppTheme.surfaceLight, height: 22),
                            ],
                            const Text(
                              '背景主题',
                              style: TextStyle(
                                color: AppTheme.textSecondary,
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: NovelTheme.values.map((t) {
                                final cfg = _themeConfigs[t]!;
                                final isSelected = t == prefs.theme;
                                return InkWell(
                                  onTap: () => prefsNotifier.setTheme(t),
                                  child: Container(
                                    width: 60,
                                    height: 32,
                                    decoration: BoxDecoration(
                                      color: cfg.bg,
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(
                                        color: isSelected ? AppTheme.primary : cfg.border,
                                        width: isSelected ? 2 : 1,
                                      ),
                                    ),
                                    child: Center(
                                      child: Text(
                                        t.name.substring(0, 3).toUpperCase(),
                                        style: TextStyle(
                                          color: cfg.text,
                                          fontSize: 9,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              }).toList(),
                            ),
                            const Divider(color: AppTheme.surfaceLight, height: 24),

                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      '字号大小',
                                      style: TextStyle(
                                        color: AppTheme.textSecondary,
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '${prefs.fontSize.toInt()} px',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                Row(
                                  children: [
                                    IconButton(
                                      icon: const Icon(LucideIcons.minus, color: Colors.white70, size: 18),
                                      onPressed: () {
                                        if (prefs.readMode == NovelReadMode.paged) {
                                          _pendingRatioJump = _currentReadingRatio(prefs.readMode);
                                        }
                                        prefsNotifier.setFontSize(prefs.fontSize - 2);
                                      },
                                    ),
                                    IconButton(
                                      icon: const Icon(LucideIcons.plus, color: Colors.white70, size: 18),
                                      onPressed: () {
                                        if (prefs.readMode == NovelReadMode.paged) {
                                          _pendingRatioJump = _currentReadingRatio(prefs.readMode);
                                        }
                                        prefsNotifier.setFontSize(prefs.fontSize + 2);
                                      },
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            const Divider(color: AppTheme.surfaceLight, height: 24),

                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text(
                                  '翻页模式',
                                  style: TextStyle(
                                    color: AppTheme.textSecondary,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                SegmentedButton<NovelReadMode>(
                                  segments: const [
                                    ButtonSegment(
                                      value: NovelReadMode.scroll,
                                      label: Text('上下滚动', style: TextStyle(fontSize: 11)),
                                    ),
                                    ButtonSegment(
                                      value: NovelReadMode.paged,
                                      label: Text('左右翻页', style: TextStyle(fontSize: 11)),
                                    ),
                                  ],
                                  selected: {prefs.readMode},
                                  onSelectionChanged: (set) {
                                    final nextMode = set.first;
                                    if (nextMode == prefs.readMode) return;
                                    _pendingRatioJump = _currentReadingRatio(prefs.readMode);
                                    prefsNotifier.setReadMode(nextMode);
                                  },
                                ),
                              ],
                            ),
                            const Divider(color: AppTheme.surfaceLight, height: 24),

                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text(
                                      '行距间距',
                                      style: TextStyle(
                                        color: AppTheme.textSecondary,
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      '${prefs.lineHeight.toStringAsFixed(1)}x',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                Row(
                                  children: [
                                    IconButton(
                                      icon: const Icon(LucideIcons.minus, color: Colors.white70, size: 18),
                                      onPressed: () {
                                        if (prefs.readMode == NovelReadMode.paged) {
                                          _pendingRatioJump = _currentReadingRatio(prefs.readMode);
                                        }
                                        prefsNotifier.setLineHeight(prefs.lineHeight - 0.1);
                                      },
                                    ),
                                    IconButton(
                                      icon: const Icon(LucideIcons.plus, color: Colors.white70, size: 18),
                                      onPressed: () {
                                        if (prefs.readMode == NovelReadMode.paged) {
                                          _pendingRatioJump = _currentReadingRatio(prefs.readMode);
                                        }
                                        prefsNotifier.setLineHeight(prefs.lineHeight + 0.1);
                                      },
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            const Divider(color: AppTheme.surfaceLight, height: 24),

                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                const Text(
                                  '使用衬线宋体 (小说阅读推荐)',
                                  style: TextStyle(color: Colors.white70, fontSize: 12),
                                ),
                                Switch(
                                  activeThumbColor: AppTheme.primary,
                                  value: prefs.serifFont,
                                  onChanged: prefsNotifier.setSerifFont,
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildChaptersDrawer(List<Chapter> chapters, int currentIndex) {
    return Drawer(
      backgroundColor: AppTheme.surface,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Row(
                children: [
                  const Icon(LucideIcons.bookOpen, color: AppTheme.primary, size: 20),
                  const SizedBox(width: 8),
                  Text(
                    '章节目录 (${chapters.length})',
                    style: const TextStyle(
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
              child: _ChapterDrawerList(
                chapters: chapters,
                currentChapterId: widget.chapterId,
                currentIndex: currentIndex,
                onSelect: (ch) {
                  Navigator.of(context).pop();
                  _openChapter(ch);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ChapterDrawerList extends StatefulWidget {
  const _ChapterDrawerList({
    required this.chapters,
    required this.currentChapterId,
    required this.currentIndex,
    required this.onSelect,
  });

  final List<Chapter> chapters;
  final String currentChapterId;
  final int currentIndex;
  final ValueChanged<Chapter> onSelect;

  @override
  State<_ChapterDrawerList> createState() => _ChapterDrawerListState();
}

class _ChapterDrawerListState extends State<_ChapterDrawerList> {
  late final ScrollController _controller;

  @override
  void initState() {
    super.initState();
    final initialOffset = widget.currentIndex > 2 ? (widget.currentIndex - 2) * 60.0 : 0.0;
    _controller = ScrollController(initialScrollOffset: initialOffset);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: _controller,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      itemExtent: 60,
      itemCount: widget.chapters.length,
      itemBuilder: (context, index) {
        final ch = widget.chapters[index];
        final isCurrent = ch.id == widget.currentChapterId;
        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          decoration: BoxDecoration(
            color: isCurrent ? AppTheme.primary.withValues(alpha: 0.1) : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isCurrent ? AppTheme.primary.withValues(alpha: 0.3) : Colors.transparent,
            ),
          ),
          child: ListTile(
            dense: true,
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
            onTap: () => widget.onSelect(ch),
          ),
        );
      },
    );
  }
}

class _ThemeConfig {
  final Color bg;
  final Color text;
  final Color card;
  final Color border;

  const _ThemeConfig({
    required this.bg,
    required this.text,
    required this.card,
    required this.border,
  });
}
