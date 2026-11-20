import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../core/identity/media_identity.dart';
import '../../../core/playback/resume_target.dart';
import '../../../core/router/app_router.dart';
import '../../../core/sources/local_sources.dart';
import '../../media/providers/media_providers.dart';
import '../../media/models/media_models.dart';
import '../../tracking/sync_provider.dart';

enum NovelTheme { obsidian, sepia, mint, light }

enum NovelReadMode { scroll, paged }

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
  // Reading preferences
  NovelTheme _theme = NovelTheme.obsidian;
  NovelReadMode _readMode = NovelReadMode.scroll;
  double _fontSize = 18.0;
  double _lineHeight = 1.8;
  bool _serifFont = true;
  bool _settingsVisible = false;
  int _currentPage = 0;

  final ScrollController _scrollController = ScrollController();
  final PageController _pageController = PageController();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  late final String _mediaType;
  late final SyncService _syncService;
  String? _chapterTitle;
  double _restoredProgress = 0.0;
  double _lastSavedProgress = -1.0;
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
    if (_restored || _userScrolled || _restoredProgress <= 0) return;
    _restored = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _userScrolled || !_scrollController.hasClients) return;
      final max = _scrollController.position.maxScrollExtent;
      _scrollController.jumpTo((_restoredProgress * max).clamp(0.0, max));
    });
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.offset;
    if (maxScroll <= 0 || currentScroll <= 0) return;
    final progress = (currentScroll / maxScroll).clamp(0.0, 1.0);
    if ((progress - _lastSavedProgress).abs() < 0.01) return;
    _persistProgress(progress);
  }

  void _saveProgress() {
    if (_disposed) return;
    if (!_userScrolled && (!_progressLoaded || (_restoredProgress > 0 && !_restored))) return;
    if (_scrollController.hasClients) {
      final maxScroll = _scrollController.position.maxScrollExtent;
      if (maxScroll > 0) {
        _persistProgress((_scrollController.offset / maxScroll).clamp(0.0, 1.0));
        return;
      }
    }
    _persistProgress(_lastSavedProgress.clamp(0.0, 1.0));
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
    if (_disposed) return;
    final clamped = progress.clamp(0.0, 1.0);
    if ((clamped - _lastSavedProgress).abs() < 0.05 && clamped < 1.0) return;
    _lastSavedProgress = clamped;
    try {
      _syncService.saveProgress(
        pluginId: widget.pluginId,
        mediaType: _mediaType,
        mediaId: widget.mediaId,
        chapterNo: 0,
        chapterId: widget.chapterId,
        chapterTitle: _chapterTitle,
        progress: clamped,
      );
    } catch (_) {}
  }

  List<List<String>> _paginateParagraphs(
    List<String> paragraphs,
    double fontSize,
    double lineHeight,
  ) {
    final charsPerPage = (520 * (18.0 / fontSize) * (1.8 / lineHeight)).round().clamp(180, 900);
    final pages = <List<String>>[];
    var current = <String>[];
    var count = 0;
    for (final p in paragraphs) {
      final len = p.length + 24;
      if (current.isNotEmpty && count + len > charsPerPage) {
        pages.add(current);
        current = <String>[];
        count = 0;
      }
      current.add(p);
      count += len;
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

  // Theme styling configurations map
  Map<NovelTheme, _ThemeConfig> get _themeConfigs => {
        NovelTheme.obsidian: const _ThemeConfig(
          bg: AppTheme.background, // Slate 950
          text: Color(0xFFE2E8F0), // Slate 200
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

  @override
  Widget build(BuildContext context) {
    // Initial progress saving is now handled by _onScroll

    final contentAsync = ref.watch(novelContentProvider((
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

    final config = _themeConfigs[_theme]!;

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
        endDrawer: _buildChaptersDrawer(chaptersAsync.value ?? []),
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
            // 1. Scrollable Text viewport
            contentAsync.when(
              data: (content) {
                if (content.trim().isEmpty) {
                  return const Center(
                    child: Text('未解析出小说正文内容。', style: TextStyle(color: AppTheme.textSecondary)),
                  );
                }

                // Split text by paragraphs
                final paragraphs = content
                    .split('\n\n')
                    .where((p) => p.trim().isNotEmpty)
                    .toList();

                if (_readMode == NovelReadMode.paged) {
                  final pages = _paginateParagraphs(paragraphs, _fontSize, _lineHeight);
                  final safePage = _currentPage.clamp(0, pages.length - 1);
                  return Stack(
                    children: [
                      GestureDetector(
                        behavior: HitTestBehavior.translucent,
                        onTapUp: (details) {
                          final width = MediaQuery.sizeOf(context).width;
                          final dx = details.localPosition.dx;
                          if (dx < width / 3) {
                            if (safePage > 0) {
                              _pageController.previousPage(
                                duration: const Duration(milliseconds: 220),
                                curve: Curves.easeOut,
                              );
                            }
                          } else if (dx > width * 2 / 3) {
                            if (safePage < pages.length - 1) {
                              _pageController.nextPage(
                                duration: const Duration(milliseconds: 220),
                                curve: Curves.easeOut,
                              );
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
                            setState(() => _currentPage = index);
                            final ratio = pages.length <= 1 ? 1.0 : index / (pages.length - 1);
                            _savePagedProgress(ratio);
                          },
                          itemBuilder: (context, index) {
                            return SingleChildScrollView(
                              padding: EdgeInsets.fromLTRB(
                                22,
                                18,
                                22,
                                56 + MediaQuery.paddingOf(context).bottom,
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  for (final p in pages[index])
                                    Padding(
                                      padding: const EdgeInsets.only(bottom: 16.0),
                                      child: Text(
                                        p.trim(),
                                        textAlign: TextAlign.justify,
                                        style: TextStyle(
                                          color: config.text,
                                          fontSize: _fontSize,
                                          fontFamily: _serifFont ? 'serif' : 'sans-serif',
                                          height: _lineHeight,
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 12 + MediaQuery.paddingOf(context).bottom,
                        child: Center(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.35),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              '第 ${safePage + 1} / ${pages.length} 页 · 点两侧翻页 / 中间设置',
                              style: TextStyle(color: config.text.withValues(alpha: 0.75), fontSize: 11),
                            ),
                          ),
                        ),
                      ),
                    ],
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
                        children: paragraphs.map((p) {
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 18.0),
                            child: Text(
                              p.trim(),
                              textAlign: TextAlign.justify,
                              style: TextStyle(
                                color: config.text,
                                fontSize: _fontSize,
                                fontFamily: _serifFont ? 'serif' : 'sans-serif',
                                height: _lineHeight,
                              ),
                            ),
                          );
                        }).toList(),
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
                    const Icon(LucideIcons.octagonAlert, size: 48, color: AppTheme.danger),
                    const SizedBox(height: 16),
                    Text(
                      '抓取小说正文失败: $err',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: config.text),
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

          // 2. Settings Toolbar overlay panel
          if (_settingsVisible)
            Positioned(
              left: 16,
              right: 16,
              bottom: 16 + MediaQuery.paddingOf(context).bottom,
              child: Material(
                color: AppTheme.surface, // Deep Slate 900
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
                    maxHeight: MediaQuery.sizeOf(context).height * 0.62,
                  ),
                  child: SingleChildScrollView(
                    child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Themes Selector
                      const Text(
                        '背景主题',
                        style: TextStyle(color: AppTheme.textSecondary, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: NovelTheme.values.map((t) {
                          final cfg = _themeConfigs[t]!;
                          final isSelected = t == _theme;
                          return InkWell(
                            onTap: () {
                              setState(() {
                                _theme = t;
                              });
                            },
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

                      // Font size adjustments
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                '字号大小',
                                style: TextStyle(color: AppTheme.textSecondary, fontSize: 10, fontWeight: FontWeight.bold),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '${_fontSize.toInt()} px',
                                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              IconButton(
                                icon: const Icon(LucideIcons.minus, color: Colors.white70, size: 18),
                                onPressed: () {
                                  setState(() {
                                    _fontSize = (_fontSize - 2).clamp(12.0, 32.0);
                                  });
                                },
                              ),
                              IconButton(
                                icon: const Icon(LucideIcons.plus, color: Colors.white70, size: 18),
                                onPressed: () {
                                  setState(() {
                                    _fontSize = (_fontSize + 2).clamp(12.0, 32.0);
                                  });
                                },
                              ),
                            ],
                          ),
                        ],
                      ),
                      const Divider(color: AppTheme.surfaceLight, height: 24),

                      // Reading mode (scroll vs paged)
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            '翻页模式',
                            style: TextStyle(color: AppTheme.textSecondary, fontSize: 10, fontWeight: FontWeight.bold),
                          ),
                          SegmentedButton<NovelReadMode>(
                            segments: const [
                              ButtonSegment(value: NovelReadMode.scroll, label: Text('上下滚动', style: TextStyle(fontSize: 11))),
                              ButtonSegment(value: NovelReadMode.paged, label: Text('左右翻页', style: TextStyle(fontSize: 11))),
                            ],
                            selected: {_readMode},
                            onSelectionChanged: (set) {
                              setState(() {
                                _readMode = set.first;
                                _currentPage = 0;
                              });
                            },
                          ),
                        ],
                      ),
                      const Divider(color: AppTheme.surfaceLight, height: 24),

                      // Line height adjustments
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                '行距间距',
                                style: TextStyle(color: AppTheme.textSecondary, fontSize: 10, fontWeight: FontWeight.bold),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '${_lineHeight.toStringAsFixed(1)}x',
                                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              IconButton(
                                icon: const Icon(LucideIcons.minus, color: Colors.white70, size: 18),
                                onPressed: () {
                                  setState(() {
                                    _lineHeight = (_lineHeight - 0.1).clamp(1.3, 2.4);
                                  });
                                },
                              ),
                              IconButton(
                                icon: const Icon(LucideIcons.plus, color: Colors.white70, size: 18),
                                onPressed: () {
                                  setState(() {
                                    _lineHeight = (_lineHeight + 0.1).clamp(1.3, 2.4);
                                  });
                                },
                              ),
                            ],
                          ),
                        ],
                      ),
                      const Divider(color: AppTheme.surfaceLight, height: 24),

                      // Font family toggles
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            '使用衬线宋体 (小说阅读推荐)',
                            style: TextStyle(color: Colors.white70, fontSize: 12),
                          ),
                          Switch(
                            activeThumbColor: AppTheme.primary,
                            value: _serifFont,
                            onChanged: (val) {
                              setState(() {
                                _serifFont = val;
                              });
                            },
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

  Widget _buildChaptersDrawer(List<Chapter> chapters) {
    return Drawer(
      backgroundColor: AppTheme.surface,
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
                    '章节目录',
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
                            route: 'novel-read',
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
