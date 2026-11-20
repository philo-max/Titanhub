import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../core/sandbox/local_plugin_runner.dart';
import '../../../core/sources/local_sources.dart';
import '../../../core/sources/media_source.dart';
import '../../../core/sources/novel/legado_book_source.dart';
import '../../../core/storage/app_database.dart';
import '../../../core/theme/app_theme.dart';
import '../../media/models/media_models.dart';
import '../../media/providers/media_providers.dart';
import '../../sources/source_hub_screen.dart';
import '../../tracking/sync_provider.dart';

const List<String> _animeHotTags = ['校园', '奇幻', '热血', '治愈', '悬疑', '科幻'];
const List<String> _animeRankingTabs = ['热门榜', '高分榜', '新作榜', '每日新番'];
const List<String> _mangaHotTags = ['热血', '恋爱', '奇幻', '搞笑', '悬疑', '日常'];

String _searchRoute({
  MediaTypeFilter? type,
  String? query,
  String? sourceId,
}) {
  final params = <String, String>{};
  if (type != null) params['type'] = type.name;
  if (query != null && query.isNotEmpty) params['q'] = query;
  if (sourceId != null && sourceId.isNotEmpty) params['source'] = sourceId;
  return Uri(path: '/search', queryParameters: params.isEmpty ? null : params)
      .toString();
}

/// Multi-page ACG aggregation hub shell with bottom navigation.
class MainShellScreen extends ConsumerStatefulWidget {
  const MainShellScreen({super.key});

  @override
  ConsumerState<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends ConsumerState<MainShellScreen> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      body: IndexedStack(
        index: _index,
        children: [
          const _AnimeHubTab(),
          const _MangaHubTab(),
          const _NovelHubTab(),
          _ShelfTab(onBrowseAnime: () => setState(() => _index = 0)),
          const SourceHubScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        key: const Key('main-bottom-nav'),
        backgroundColor: AppTheme.surface,
        indicatorColor: AppTheme.primary.withValues(alpha: 0.2),
        selectedIndex: _index,
        onDestinationSelected: (value) => setState(() => _index = value),
        destinations: const [
          NavigationDestination(
            icon: Icon(LucideIcons.tv),
            label: '动漫',
          ),
          NavigationDestination(
            icon: Icon(LucideIcons.bookOpen),
            label: '漫画',
          ),
          NavigationDestination(
            icon: Icon(LucideIcons.fileText),
            label: '小说',
          ),
          NavigationDestination(
            icon: Icon(LucideIcons.bookmark),
            label: '书架',
          ),
          NavigationDestination(
            icon: Icon(LucideIcons.slidersHorizontal),
            label: '源中心',
          ),
        ],
      ),
    );
  }
}

class _HubHeader extends StatelessWidget {
  const _HubHeader({
    required this.title,
    required this.hint,
    required this.defaultType,
  });

  final String title;
  final String hint;
  final MediaTypeFilter defaultType;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: AppTheme.textPrimary,
                  ),
                ),
                const Spacer(),
                IconButton(
                  tooltip: 'WebDAV 云同步',
                  onPressed: () => context.push('/webdav'),
                  icon: const Icon(LucideIcons.cloud,
                      size: 20, color: AppTheme.textSecondary),
                ),
              ],
            ),
            const SizedBox(height: 8),
            InkWell(
              key: Key('hub-search-bar-${defaultType.name}'),
              borderRadius: BorderRadius.circular(12),
              onTap: () => context.push(_searchRoute(type: defaultType)),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                decoration: BoxDecoration(
                  color: AppTheme.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppTheme.border),
                ),
                child: Row(
                  children: [
                    const Icon(LucideIcons.search,
                        size: 16, color: AppTheme.textSecondary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        hint,
                        style: const TextStyle(
                            fontSize: 13, color: AppTheme.textSecondary),
                      ),
                    ),
                    const Text(
                      '搜索',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppTheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AnimeHubTab extends ConsumerStatefulWidget {
  const _AnimeHubTab();

  @override
  ConsumerState<_AnimeHubTab> createState() => _AnimeHubTabState();
}

class _AnimeHubTabState extends ConsumerState<_AnimeHubTab> {
  String _rankingTab = _animeRankingTabs.first;

  @override
  Widget build(BuildContext context) {
    final activeSources = ref.watch(activeSourcesProvider);
    final animeSources = [
      for (final s in activeSources)
        if (s.types.contains('anime')) s,
    ];
    final hasBangumi = animeSources.any((s) => s.id == 'bangumi');
    final exploreAsync = hasBangumi
        ? ref.watch(sourceExploreItemsProvider(
            (pluginId: 'bangumi', tab: _rankingTab, mediaType: 'anime'),
          ))
        : const AsyncValue<List<MediaItem>>.data([]);

    return CustomScrollView(
      slivers: [
        const SliverToBoxAdapter(
          child: _HubHeader(
            title: 'Titanhub · 番剧',
            hint: '点击搜索番剧名、标签或直达可用播放源…',
            defaultType: MediaTypeFilter.anime,
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (final tab in _animeRankingTabs)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            key: Key('anime-ranking-$tab'),
                            label: Text(tab, style: const TextStyle(fontSize: 12)),
                            selected: tab == _rankingTab,
                            selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                            onSelected: (_) => setState(() => _rankingTab = tab),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (final tag in _animeHotTags)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: ActionChip(
                            visualDensity: VisualDensity.compact,
                            label: Text('#$tag', style: const TextStyle(fontSize: 11)),
                            onPressed: () => context.push(_searchRoute(
                              type: MediaTypeFilter.anime,
                              query: 'tag:$tag',
                            )),
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        exploreAsync.when(
          loading: () => const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(
                  child: CircularProgressIndicator(color: AppTheme.primary)),
            ),
          ),
          error: (err, _) => SliverToBoxAdapter(
            child: _EmptyHubBanner(
              message: '番剧排行榜加载失败：$err',
              actionLabel: '前往搜索番剧',
              onAction: () =>
                  context.push(_searchRoute(type: MediaTypeFilter.anime)),
            ),
          ),
          data: (items) {
            if (items.isEmpty) {
              return SliverToBoxAdapter(
                child: _EmptyHubBanner(
                  message: hasBangumi
                      ? '暂无「$_rankingTab」数据，点下方直接搜索番剧。'
                      : '未启用 Bangumi 推荐源，可在「源中心」开启或直接搜索。',
                  actionLabel: '去搜番剧',
                  onAction: () =>
                      context.push(_searchRoute(type: MediaTypeFilter.anime)),
                ),
              );
            }
            return _MediaPosterGrid(items: items);
          },
        ),
        const SliverToBoxAdapter(child: SizedBox(height: 24)),
      ],
    );
  }
}

class _MangaHubTab extends ConsumerStatefulWidget {
  const _MangaHubTab();

  @override
  ConsumerState<_MangaHubTab> createState() => _MangaHubTabState();
}

class _MangaHubTabState extends ConsumerState<_MangaHubTab> {
  String? _selectedSourceId;
  String? _selectedTab;

  @override
  Widget build(BuildContext context) {
    final activeSources = ref.watch(activeSourcesProvider);
    final mangaSources = [
      for (final s in activeSources)
        if (s.types.contains('manga')) s,
    ];
    final currentSourceId = mangaSources.any((s) => s.id == _selectedSourceId)
        ? _selectedSourceId!
        : (mangaSources.isNotEmpty ? mangaSources.first.id : null);

    return CustomScrollView(
      slivers: [
        const SliverToBoxAdapter(
          child: _HubHeader(
            title: 'Titanhub · 漫画',
            hint: '点击搜索漫画名、作者或标签…',
            defaultType: MediaTypeFilter.manga,
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 16, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: [
                    for (final tag in _mangaHotTags)
                      ActionChip(
                        label: Text(tag, style: const TextStyle(fontSize: 12)),
                        onPressed: () => context.push(_searchRoute(
                          type: MediaTypeFilter.manga,
                          query: tag,
                        )),
                      ),
                  ],
                ),
                if (mangaSources.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  const Text('漫画来源发现页',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppTheme.textPrimary)),
                  const SizedBox(height: 8),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (final src in mangaSources)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text(src.name,
                                  style: const TextStyle(fontSize: 12)),
                              selected: src.id == currentSourceId,
                              selectedColor:
                                  AppTheme.primary.withValues(alpha: 0.25),
                              onSelected: (_) => setState(() {
                                _selectedSourceId = src.id;
                                _selectedTab = null;
                              }),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (currentSourceId == null)
          SliverToBoxAdapter(
            child: _EmptyHubBanner(
              message: '当前没有启用的漫画源，请先到「源中心」开启或巡检来源。',
              actionLabel: '去搜索页',
              onAction: () =>
                  context.push(_searchRoute(type: MediaTypeFilter.manga)),
            ),
          )
        else
          _MangaSourceExploreSliver(
            pluginId: currentSourceId,
            selectedTab: _selectedTab,
            onSelectTab: (t) => setState(() => _selectedTab = t),
          ),
        const SliverToBoxAdapter(child: SizedBox(height: 24)),
      ],
    );
  }
}

class _MangaSourceExploreSliver extends ConsumerWidget {
  const _MangaSourceExploreSliver({
    required this.pluginId,
    required this.selectedTab,
    required this.onSelectTab,
  });

  final String pluginId;
  final String? selectedTab;
  final ValueChanged<String> onSelectTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tabsAsync = ref.watch(sourceExploreTabsProvider(pluginId));
    return tabsAsync.when(
      loading: () => const SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 48),
          child: Center(
              child: CircularProgressIndicator(color: AppTheme.primary)),
        ),
      ),
      error: (err, _) => SliverToBoxAdapter(
        child: _EmptyHubBanner(
          message: '读取该源榜单失败：$err',
          actionLabel: '直接搜索该源',
          onAction: () => context.push(_searchRoute(
            type: MediaTypeFilter.manga,
            sourceId: pluginId,
          )),
        ),
      ),
      data: (tabs) {
        if (tabs.isEmpty) {
          return SliverToBoxAdapter(
            child: _EmptyHubBanner(
              message: '该漫画源暂未提供官网发现/榜单页，可以直接进搜索页搜关键词。',
              actionLabel: '直接搜索该源',
              onAction: () => context.push(_searchRoute(
                type: MediaTypeFilter.manga,
                sourceId: pluginId,
              )),
            ),
          );
        }
        final activeTab =
            selectedTab != null && tabs.contains(selectedTab)
                ? selectedTab!
                : tabs.first;
        final itemsAsync = ref.watch(sourceExploreItemsProvider(
          (pluginId: pluginId, tab: activeTab, mediaType: 'manga'),
        ));
        return SliverMainAxisGroup(
          slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      for (final tab in tabs)
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(tab, style: const TextStyle(fontSize: 12)),
                            selected: tab == activeTab,
                            selectedColor:
                                AppTheme.accent.withValues(alpha: 0.25),
                            onSelected: (_) => onSelectTab(tab),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
            itemsAsync.when(
              loading: () => const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.symmetric(vertical: 48),
                  child: Center(
                      child:
                          CircularProgressIndicator(color: AppTheme.primary)),
                ),
              ),
              error: (err, _) => SliverToBoxAdapter(
                child: _EmptyHubBanner(
                  message: '「$activeTab」加载失败：$err',
                  actionLabel: '直接搜索该源',
                  onAction: () => context.push(_searchRoute(
                    type: MediaTypeFilter.manga,
                    sourceId: pluginId,
                  )),
                ),
              ),
              data: (items) {
                if (items.isEmpty) {
                  return SliverToBoxAdapter(
                    child: _EmptyHubBanner(
                      message: '「$activeTab」未返回内容（部分站点需先设置网络或直接关键词搜索）。',
                      actionLabel: '直接搜索该源',
                      onAction: () => context.push(_searchRoute(
                        type: MediaTypeFilter.manga,
                        sourceId: pluginId,
                      )),
                    ),
                  );
                }
                return _MediaPosterGrid(items: items);
              },
            ),
          ],
        );
      },
    );
  }
}

class _ShelfTab extends ConsumerStatefulWidget {
  const _ShelfTab({required this.onBrowseAnime});

  final VoidCallback onBrowseAnime;

  @override
  ConsumerState<_ShelfTab> createState() => _ShelfTabState();
}

class _ShelfTabState extends ConsumerState<_ShelfTab> {
  int _refreshSeed = 0;

  @override
  Widget build(BuildContext context) {
    final db = ref.watch(databaseProvider);
    return SafeArea(
      child: FutureBuilder<(List<LocalFavorite>, List<LocalTrackingData>)>(
        key: ValueKey(_refreshSeed),
        future: Future.wait([db.getAllFavorites(), db.getAllTracking()])
            .then((res) => (
                  res[0] as List<LocalFavorite>,
                  res[1] as List<LocalTrackingData>,
                )),
        builder: (context, snapshot) {
          final favs = snapshot.data?.$1 ?? const <LocalFavorite>[];
          final history = snapshot.data?.$2 ?? const <LocalTrackingData>[];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  const Text(
                    '我的书架 & 记录',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: '刷新书架',
                    onPressed: () => setState(() => _refreshSeed++),
                    icon: const Icon(LucideIcons.refreshCw,
                        size: 18, color: AppTheme.textSecondary),
                  ),
                  IconButton(
                    tooltip: 'WebDAV 同步',
                    onPressed: () => context.push('/webdav'),
                    icon: const Icon(LucideIcons.cloud,
                        size: 18, color: AppTheme.textSecondary),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (snapshot.connectionState == ConnectionState.waiting &&
                  snapshot.data == null)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 48),
                  child: Center(
                      child:
                          CircularProgressIndicator(color: AppTheme.primary)),
                )
              else if (favs.isEmpty && history.isEmpty)
                _EmptyHubBanner(
                  message: '书架还是空的，去动漫或漫画板块挑一部作品加入收藏吧~',
                  actionLabel: '去逛逛番剧',
                  onAction: widget.onBrowseAnime,
                )
              else ...[
                if (favs.isNotEmpty) ...[
                  Text('本地收藏 (${favs.length})',
                      style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textPrimary)),
                  const SizedBox(height: 8),
                  for (final f in favs)
                    _ShelfEntryTile(
                      title: f.mediaId,
                      subtitle: '${f.pluginId} · ${f.mediaType}',
                      onTap: () => context.push(
                        '/detail/${Uri.encodeComponent(f.pluginId)}/${Uri.encodeComponent(f.mediaId)}',
                      ),
                    ),
                  const SizedBox(height: 16),
                ],
                if (history.isNotEmpty) ...[
                  Text('最近进度 (${history.length})',
                      style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: AppTheme.textPrimary)),
                  const SizedBox(height: 8),
                  for (final h in history.reversed)
                    _ShelfEntryTile(
                      title: h.mediaId,
                      subtitle:
                          '${h.pluginId} · ${h.chapterTitle ?? '第 ${h.chapterNo} 话/集'}',
                      onTap: () => context.push(
                        '/detail/${Uri.encodeComponent(h.pluginId)}/${Uri.encodeComponent(h.mediaId)}',
                      ),
                    ),
                ],
              ],
            ],
          );
        },
      ),
    );
  }
}

class _ShelfEntryTile extends StatelessWidget {
  const _ShelfEntryTile({
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: AppTheme.surface,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppTheme.border),
      ),
      child: ListTile(
        onTap: onTap,
        leading: const SizedBox(
          width: 42,
          height: 56,
          child: Icon(LucideIcons.book, size: 18, color: AppTheme.textSecondary),
        ),
        title: Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppTheme.textPrimary),
        ),
        subtitle: Text(
          subtitle,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
        ),
        trailing: const Icon(LucideIcons.chevronRight,
            size: 16, color: AppTheme.textSecondary),
      ),
    );
  }
}

class _MediaPosterGrid extends StatelessWidget {
  const _MediaPosterGrid({required this.items});

  final List<MediaItem> items;

  @override
  Widget build(BuildContext context) {
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          mainAxisSpacing: 12,
          crossAxisSpacing: 10,
          childAspectRatio: 0.68,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final item = items[index];
            final pluginId = item.pluginId ?? '';
            return InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: pluginId.isEmpty
                  ? null
                  : () => context.push(
                        '/detail/${Uri.encodeComponent(pluginId)}/${Uri.encodeComponent(item.id)}',
                      ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Container(
                      color: AppTheme.surfaceLight,
                      child: item.cover.isNotEmpty
                          ? CachedNetworkImage(
                              imageUrl: item.cover,
                              fit: BoxFit.cover,
                              errorWidget: (_, __, ___) => const Center(
                                child: Icon(LucideIcons.imageOff,
                                    size: 20, color: AppTheme.textSecondary),
                              ),
                            )
                          : const Center(
                              child: Icon(LucideIcons.film,
                                  size: 22, color: AppTheme.textSecondary),
                            ),
                    ),
                    Positioned(
                      left: 0,
                      right: 0,
                      bottom: 0,
                      child: Container(
                        padding: const EdgeInsets.fromLTRB(8, 22, 8, 8),
                        decoration: const BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [Colors.transparent, Color(0xDD000000)],
                          ),
                        ),
                        child: Text(
                          item.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                            height: 1.25,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
          childCount: items.length,
        ),
      ),
    );
  }
}

class _EmptyHubBanner extends StatelessWidget {
  const _EmptyHubBanner({
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  final String message;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Card(
        color: AppTheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: const BorderSide(color: AppTheme.border),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 12, color: AppTheme.textSecondary),
              ),
              const SizedBox(height: 12),
              FilledButton.tonal(
                onPressed: onAction,
                child: Text(actionLabel),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

const List<String> _novelTabs = ['电击文库', '轻小说榜'];

class _NovelHubTab extends ConsumerStatefulWidget {
  const _NovelHubTab();

  @override
  ConsumerState<_NovelHubTab> createState() => _NovelHubTabState();
}

class _NovelHubTabState extends ConsumerState<_NovelHubTab> {
  String _activeTab = _novelTabs.first;

  Future<void> _showImportLegadoDialog() async {
    final controller = TextEditingController();
    final raw = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('导入 Legado 书源 (JSON)',
            style: TextStyle(color: AppTheme.textPrimary, fontSize: 16)),
        content: TextField(
          controller: controller,
          maxLines: 6,
          style: const TextStyle(color: AppTheme.textPrimary, fontSize: 12),
          decoration: const InputDecoration(
            hintText: '粘贴单个或数组格式的 Legado 书源 JSON…',
            hintStyle: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('导入'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (raw == null || raw.isEmpty || !mounted) return;
    try {
      final parsed = LegadoBookSource.parseList(raw);
      if (parsed.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('未识别到有效的 Legado 书源')),
        );
        return;
      }
      final runner = ref.read(localPluginRunnerProvider);
      final added = <MediaSource>[];
      final addedIds = <String>{};
      for (var i = 0; i < parsed.length; i++) {
        final s = parsed[i];
        final id = 'legado-${s.name.hashCode}-$i';
        runner.registerLegadoSource(id, s);
        addedIds.add(id);
        added.add(MediaSource(
          id: id,
          name: s.name,
          types: const ['novel'],
          capabilities: const {
            MediaCapability.search,
            MediaCapability.detail,
            MediaCapability.chapters,
            MediaCapability.content,
          },
        ));
      }
      ref.read(installedNovelSourcesProvider.notifier).update((list) => [...list, ...added]);
      ref.read(enabledSourceIdsProvider.notifier).update((s) => {...s, ...addedIds});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已导入 ${added.length} 个 Legado 小说源')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('书源 JSON 解析失败：$e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final activeSources = ref.watch(activeSourcesProvider);
    final novelSources = [
      for (final s in activeSources)
        if (s.types.contains('novel')) s,
    ];
    final hasBangumi = ref.watch(enabledSourceIdsProvider).contains('bangumi');
    final exploreAsync = hasBangumi
        ? ref.watch(sourceExploreItemsProvider(
            (pluginId: 'bangumi', tab: _activeTab, mediaType: 'novel'),
          ))
        : const AsyncValue<List<MediaItem>>.data([]);

    return CustomScrollView(
      slivers: [
        const SliverToBoxAdapter(
          child: _HubHeader(
            title: 'Titanhub · 轻小说',
            hint: '搜索电击文库、轻小说或已导入书源…',
            defaultType: MediaTypeFilter.novel,
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    for (final tab in _novelTabs)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          key: Key('novel-tab-$tab'),
                          label: Text(tab, style: const TextStyle(fontSize: 12)),
                          selected: tab == _activeTab,
                          selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                          onSelected: (_) => setState(() => _activeTab = tab),
                        ),
                      ),
                    const Spacer(),
                    TextButton.icon(
                      key: const Key('novel-import-legado'),
                      onPressed: _showImportLegadoDialog,
                      icon: const Icon(LucideIcons.plus, size: 14),
                      label: const Text('导入书源', style: TextStyle(fontSize: 12)),
                    ),
                  ],
                ),
                if (novelSources.where((s) => s.id != 'bangumi').isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final src in novelSources.where((s) => s.id != 'bangumi'))
                        ActionChip(
                          label: Text(src.name, style: const TextStyle(fontSize: 11)),
                          onPressed: () => context.push(_searchRoute(
                            type: MediaTypeFilter.novel,
                            sourceId: src.id,
                          )),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
        exploreAsync.when(
          loading: () => const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(
                  child: CircularProgressIndicator(color: AppTheme.primary)),
            ),
          ),
          error: (err, _) => SliverToBoxAdapter(
            child: _EmptyHubBanner(
              message: '小说榜单加载失败：$err',
              actionLabel: '前往搜索小说',
              onAction: () =>
                  context.push(_searchRoute(type: MediaTypeFilter.novel)),
            ),
          ),
          data: (items) {
            if (items.isEmpty) {
              return SliverToBoxAdapter(
                child: _EmptyHubBanner(
                  message: '暂无「$_activeTab」数据，可导入 Legado 书源或前往搜索。',
                  actionLabel: '导入 Legado 书源',
                  onAction: _showImportLegadoDialog,
                ),
              );
            }
            return _MediaPosterGrid(items: items);
          },
        ),
        const SliverToBoxAdapter(child: SizedBox(height: 24)),
      ],
    );
  }
}
