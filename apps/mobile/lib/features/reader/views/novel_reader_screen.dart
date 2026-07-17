import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../media/providers/media_providers.dart';
import '../../media/models/media_models.dart';
import '../../tracking/sync_provider.dart';

enum NovelTheme { obsidian, sepia, mint, light }

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

class _NovelReaderScreenState extends ConsumerState<NovelReaderScreen> {
  // Reading preferences
  NovelTheme _theme = NovelTheme.obsidian;
  double _fontSize = 18.0;
  bool _serifFont = true;
  bool _settingsVisible = false;
  
  final ScrollController _scrollController = ScrollController();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  
  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.offset;
    if (maxScroll > 0 && currentScroll > 0) {
      final progress = (currentScroll / maxScroll).clamp(0.0, 1.0);
      ref.read(syncServiceProvider).saveProgress(
        mediaId: widget.mediaId,
        pluginId: widget.pluginId,
        mediaType: 'novel',
        chapterNo: 1, // You could get this from chapters list
        chapterId: widget.chapterId,
        progress: progress,
        status: 'watching',
      );
    }
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  // Theme styling configurations map
  Map<NovelTheme, _ThemeConfig> get _themeConfigs => {
        NovelTheme.obsidian: const _ThemeConfig(
          bg: Color(0xFF030712), // Slate 950
          text: Color(0xFFE2E8F0), // Slate 200
          card: Color(0xFF0F172A),
          border: Color(0xFF1E293B),
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
          text: Color(0xFF1E293B),
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

    final config = _themeConfigs[_theme]!;

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: config.bg,
      endDrawer: _buildChaptersDrawer(chaptersAsync.value ?? []),
      appBar: AppBar(
        title: Text(
          widget.chapterId,
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
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: Icon(LucideIcons.type, color: config.text),
            onPressed: () {
              setState(() {
                _settingsVisible = !_settingsVisible;
              });
            },
          ),
          IconButton(
            icon: Icon(LucideIcons.menu, color: config.text),
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
                  child: Text('未解析出小说正文内容。', style: TextStyle(color: const Color(0xFF64748B))),
                );
              }

              // Split text by paragraphs
              final paragraphs = content
                  .split('\n\n')
                  .where((p) => p.trim().isNotEmpty)
                  .toList();

              return SingleChildScrollView(
                controller: _scrollController,
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 120),
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
                            height: 1.8,
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                ),
              );
            },
            loading: () => const Center(
              child: CircularProgressIndicator(color: const Color(0xFF8B5CF6)),
            ),
            error: (err, _) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(LucideIcons.octagonAlert, size: 48, color: const Color(0xFFF43F5E)),
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
              bottom: 16,
              child: Material(
                color: const Color(0xFF0F172A), // Deep Slate 900
                elevation: 10,
                borderRadius: BorderRadius.circular(20),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFF1E293B)),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Themes Selector
                      const Text(
                        '背景主题',
                        style: TextStyle(color: const Color(0xFF64748B), fontSize: 10, fontWeight: FontWeight.bold),
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
                                  color: isSelected ? const Color(0xFF8B5CF6) : cfg.border,
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
                      const Divider(color: Color(0xFF1E293B), height: 24),

                      // Font size adjustments
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                '字号大小',
                                style: TextStyle(color: const Color(0xFF64748B), fontSize: 10, fontWeight: FontWeight.bold),
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
                      const Divider(color: Color(0xFF1E293B), height: 24),

                      // Font family toggles
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            '使用衬线宋体 (小说阅读推荐)',
                            style: TextStyle(color: Colors.white70, fontSize: 12),
                          ),
                          Switch(
                            activeColor: const Color(0xFF8B5CF6),
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
        ],
      ),
    );
  }

  Widget _buildChaptersDrawer(List<Chapter> chapters) {
    return Drawer(
      backgroundColor: const Color(0xFF0F172A),
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Padding(
              padding: EdgeInsets.all(16.0),
              child: Row(
                children: [
                  Icon(LucideIcons.bookOpen, color: const Color(0xFF8B5CF6), size: 20),
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
            const Divider(color: Color(0xFF1E293B)),
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
                      color: isCurrent ? const Color(0xFF8B5CF6).withOpacity(0.1) : Colors.transparent,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: isCurrent ? const Color(0xFF8B5CF6).withOpacity(0.3) : Colors.transparent,
                      ),
                    ),
                    child: ListTile(
                      title: Text(
                        ch.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: isCurrent ? const Color(0xFF8B5CF6) : const Color(0xFF64748B),
                          fontSize: 13,
                          fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                        ),
                      ),
                      onTap: () {
                        context.pop(); // Close drawer
                        context.pushReplacement(
                          '/novel-read/${widget.pluginId}/${widget.mediaId}/${ch.id}',
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
