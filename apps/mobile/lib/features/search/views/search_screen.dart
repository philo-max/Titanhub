import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../media/models/media_models.dart';
import '../../media/providers/media_providers.dart';
import '../../tracking/sync_provider.dart';
import '../../tracking/auth_dialog.dart';
import '../../../core/network/api_client.dart';
import '../../../core/sources/unified/unified_sources.dart';
import '../../../core/sources/local_sources.dart';
import '../../../core/sources/media_source.dart';
import '../../../core/theme/app_theme.dart';

const List<String> _hotTags = [
  '热血',
  '恋爱',
  '校园',
  '奇幻',
  '悬疑',
  '科幻',
  '日常',
  '百合',
];

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  String? _resultSourceFilter;
  String? _selectedExploreTab;

  void _performSearch() {
    setState(() {
      _searchQuery = _searchController.text.trim();
      _resultSourceFilter = null;
    });
  }

  void _searchTag(String tag) {
    _searchController.text = tag;
    setState(() {
      _searchQuery = tag;
      _resultSourceFilter = null;
    });
  }

  void _selectType(MediaTypeFilter filter) {
    ref.read(selectedMediaTypeProvider.notifier).state = filter;
    ref.read(selectedSourceIdProvider.notifier).state = null;
    setState(() {
      _resultSourceFilter = null;
      _selectedExploreTab = null;
    });
  }

  void _selectSource(String? sourceId) {
    final current = ref.read(selectedSourceIdProvider);
    ref.read(selectedSourceIdProvider.notifier).state = current == sourceId ? null : sourceId;
    setState(() {
      _resultSourceFilter = null;
      _selectedExploreTab = null;
    });
  }

  void _showSourcesSheet() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppTheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppTheme.radius3XL)),
      ),
      builder: (sheetContext) {
        return Consumer(
          builder: (context, ref, _) {
            final sources = ref.watch(localSourcesProvider);
            final enabled = ref.watch(enabledSourceIdsProvider);
            final remoteEnabled = ref.watch(remoteEnabledProvider);
            return SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      '本机来源',
                      style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      '全部在本机执行，不依赖电脑。关闭某个来源后不再搜索它。',
                      style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                    ),
                    const SizedBox(height: 8),
                    for (final source in sources)
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: enabled.contains(source.id),
                        activeColor: AppTheme.primary,
                        title: Text(source.name,
                            style: const TextStyle(color: Colors.white, fontSize: 14)),
                        subtitle: Text(
                          '${source.types.join(' / ')} · ${source.capabilitySummary}',
                          style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
                        ),
                        onChanged: (checked) {
                          final next = {...enabled};
                          if (checked == true) {
                            next.add(source.id);
                          } else {
                            next.remove(source.id);
                          }
                          ref.read(enabledSourceIdsProvider.notifier).state = next;
                        },
                      ),
                    const Divider(color: AppTheme.surfaceLight, height: 24),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      value: ref.watch(dataSaverEnabledProvider),
                      activeThumbColor: AppTheme.primary,
                      title: const Text('MangaDex 省流高速通道',
                          style: TextStyle(color: Colors.white, fontSize: 14)),
                      subtitle: const Text(
                        '优先加载压缩图片（体积更小、加载更快，适合移动网络）',
                        style: TextStyle(color: AppTheme.textTertiary, fontSize: 11),
                      ),
                      onChanged: (value) {
                        ref.read(dataSaverEnabledProvider.notifier).state = value;
                      },
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      value: remoteEnabled,
                      activeThumbColor: AppTheme.primary,
                      title: const Text('连接电脑/服务器（可选）',
                          style: TextStyle(color: Colors.white, fontSize: 14)),
                      subtitle: Text(
                        remoteEnabled
                            ? '已开启：本机来源失败时会尝试服务器 ${ref.watch(serverUrlProvider)}'
                            : '已关闭：只使用本机来源，不访问电脑',
                        style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
                      ),
                      onChanged: (value) {
                        ref.read(remoteEnabledProvider.notifier).state = value;
                        ref.invalidate(searchMediaProvider);
                      },
                    ),
                    if (remoteEnabled)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: TextButton(
                          onPressed: () => _showServerConfigDialog(),
                          child: const Text('配置服务器 URL'),
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  void _showServerConfigDialog() {
    final currentUrl = ref.read(serverUrlProvider);
    final textController = TextEditingController(text: currentUrl);

    showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          backgroundColor: AppTheme.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusLG),
            side: const BorderSide(color: AppTheme.border, width: 1),
          ),
          title: const Text(
            '配置服务器 URL',
            style: TextStyle(color: AppTheme.textPrimary, fontSize: 18, fontWeight: FontWeight.bold),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '仅在显式开启远端时使用。手机与电脑需在同一局域网，填写电脑的局域网地址，如 http://192.168.x.x:3001。',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: textController,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: const InputDecoration(
                  labelText: '服务器 URL',
                  labelStyle: TextStyle(color: AppTheme.textSecondary),
                  enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppTheme.border)),
                  focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppTheme.primary)),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('取消', style: TextStyle(color: AppTheme.textSecondary)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppTheme.primary,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMD),
                ),
              ),
              onPressed: () async {
                final newUrl = textController.text.trim();
                if (newUrl.isNotEmpty) {
                  await ref.read(serverUrlProvider.notifier).updateUrl(newUrl);
                  ref.invalidate(searchMediaProvider);
                }
                if (dialogContext.mounted) Navigator.pop(dialogContext);
              },
              child: const Text('保存'),
            ),
          ],
        );
      },
    );
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pendingQuery = ref.watch(pendingSearchQueryProvider);
    if (pendingQuery != null && pendingQuery.isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ref.read(pendingSearchQueryProvider.notifier).state = null;
        _searchTag(pendingQuery);
      });
    }
    final selectedType = ref.watch(selectedMediaTypeProvider);
    final searchResults =
        ref.watch(searchMediaProvider((query: _searchQuery, type: selectedType)));
    final activeSources = ref.watch(activeSourcesProvider);
    final categorySources = ref.watch(typeSourcesProvider(selectedType));
    final typeSources = ref.watch(searchSourcesProvider(selectedType));
    final selectedSourceId = ref.watch(selectedSourceIdProvider);
    final effectiveSelectedSourceId = categorySources.any((s) => s.id == selectedSourceId) ? selectedSourceId : null;
    final remoteEnabled = ref.watch(remoteEnabledProvider);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Row(
          children: [
            Icon(Icons.bolt, color: AppTheme.primary),
            SizedBox(width: 8),
            Text('Titanhub', style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.1)),
          ],
        ),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          Consumer(
            builder: (context, ref, child) {
              final token = ref.watch(authTokenProvider);
              return IconButton(
                tooltip: '同步账号（可选）',
                icon: Icon(
                  token != null ? Icons.account_circle : Icons.person_outline,
                  color: token != null ? AppTheme.primary : AppTheme.textSecondary,
                ),
                onPressed: () {
                  showDialog<void>(context: context, builder: (context) => const AuthDialog());
                },
              );
            },
          ),
          GestureDetector(
            onTap: _showSourcesSheet,
            child: Container(
              margin: const EdgeInsets.only(right: 16, top: 12, bottom: 12),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: AppTheme.surfaceLight,
                borderRadius: BorderRadius.circular(AppTheme.radius2XL),
                border: Border.all(color: AppTheme.surfaceElevated),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.circle,
                      color: activeSources.isEmpty ? AppTheme.danger : AppTheme.success, size: 8),
                  const SizedBox(width: 6),
                  Text(
                    remoteEnabled ? '本机 ${activeSources.length} · 远端' : '本机 ${activeSources.length}',
                    style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      body: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '一个应用，看遍所有',
                    style: TextStyle(
                      color: AppTheme.textSecondary,
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'ACG 全内容聚合门户',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 32,
                      fontWeight: FontWeight.w800,
                      height: 1.2,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Container(
                    decoration: BoxDecoration(
                      color: AppTheme.surface,
                      borderRadius: BorderRadius.circular(AppTheme.radius2XL),
                      border: Border.all(color: AppTheme.surfaceLight),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    child: Row(
                      children: [
                        const Icon(LucideIcons.search, color: AppTheme.textTertiary, size: 20),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextField(
                            controller: _searchController,
                            onSubmitted: (_) => _performSearch(),
                            style: const TextStyle(color: AppTheme.textPrimary),
                            decoration: const InputDecoration(
                              hintText: '搜索动漫、漫画、轻小说...',
                              hintStyle: TextStyle(color: AppTheme.textTertiary),
                              border: InputBorder.none,
                              isDense: true,
                            ),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(LucideIcons.arrowRight, color: AppTheme.primary),
                          onPressed: _performSearch,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final filter in MediaTypeFilter.values)
                        ChoiceChip(
                          key: Key('search-type-${filter.name}'),
                          label: Text(filter.label),
                          selected: filter == selectedType,
                          selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                          onSelected: (_) => _selectType(filter),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (categorySources.isNotEmpty) ...[
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              key: const Key('search-source-all'),
                              label: Text('全部来源 (${categorySources.length})'),
                              selected: effectiveSelectedSourceId == null,
                              selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                              onSelected: (_) => ref.read(selectedSourceIdProvider.notifier).state = null,
                            ),
                          ),
                          for (final source in categorySources)
                            Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: ChoiceChip(
                                key: Key('search-source-${source.id}'),
                                label: Text(source.name),
                                selected: effectiveSelectedSourceId == source.id,
                                selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                                onSelected: (_) => _selectSource(source.id),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  Text(
                    typeSources.length == 1
                        ? '本机来源：${typeSources.single.name}'
                        : typeSources.isNotEmpty
                            ? '当前区域已启用 ${typeSources.length} 个本机来源，可在上方单选'
                            : selectedType == MediaTypeFilter.all
                                ? '当前没有启用任何本机来源，点右上角选择来源。'
                                : '「${selectedType.label}」分类没有已启用的本机来源，点右上角选择来源。',
                    style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
                  ),
                  const SizedBox(height: 12),
                  SingleChildScrollView(
                    key: const Key('search-hot-tags'),
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        const Padding(
                          padding: EdgeInsets.only(right: 8),
                          child: Icon(LucideIcons.tag, size: 13, color: AppTheme.primary),
                        ),
                        for (final tag in _hotTags)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ActionChip(
                              key: Key('search-tag-$tag'),
                              label: Text(tag, style: const TextStyle(fontSize: 11)),
                              backgroundColor: AppTheme.surface,
                              side: const BorderSide(color: AppTheme.surfaceLight),
                              onPressed: () => _searchTag(tag),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  _buildWebDavEntry(context),
                  const SizedBox(height: 12),
                  _buildKazumiEntry(context),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),
          if (_searchQuery.isNotEmpty)
            searchResults.when(
              data: (outcome) => _buildResults(outcome),
              error: (err, stack) => SliverToBoxAdapter(
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 48.0, horizontal: 24.0),
                    child: Text(
                      '执行失败: $err',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppTheme.danger),
                    ),
                  ),
                ),
              ),
              loading: () => const SliverToBoxAdapter(
                child: Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(vertical: 64.0),
                    child: Column(
                      children: [
                        CircularProgressIndicator(color: AppTheme.primary),
                        SizedBox(height: 16),
                        Text(
                          '正在搜索所选来源...',
                          style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          if (_searchQuery.isEmpty && effectiveSelectedSourceId != null)
            _buildSourceExploreSection(
              pluginId: effectiveSelectedSourceId,
              mediaType: selectedType.type ??
                  (ref.read(sourceByIdProvider(effectiveSelectedSourceId))?.types.firstOrNull ?? 'manga'),
            ),
          if (_searchQuery.isEmpty && effectiveSelectedSourceId == null)
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              sliver: SliverGrid.count(
                crossAxisCount: 2,
                mainAxisSpacing: 16,
                crossAxisSpacing: 16,
                childAspectRatio: 1.4,
                children: [
                  _buildCategoryCard(context, MediaTypeFilter.anime, selectedType, '动漫 (Anime)',
                      LucideIcons.film, '七色番播放 · Bangumi 资料', AppTheme.primary),
                  _buildCategoryCard(context, MediaTypeFilter.manga, selectedType, '漫画 (Manga)',
                      LucideIcons.bookOpen, 'MangaDex 图片', Colors.cyanAccent),
                  _buildCategoryCard(context, MediaTypeFilter.novel, selectedType, '轻小说 (Novel)',
                      LucideIcons.fileText, '暂无本机来源', Colors.pinkAccent),
                  _buildCategoryCard(context, MediaTypeFilter.movie, selectedType, '影视 (Movie)',
                      LucideIcons.tv, '暂无本机来源', Colors.amberAccent),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildResults(SearchOutcome outcome) {
    if (outcome.items.isEmpty) {
      return SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 48.0, horizontal: 24.0),
          child: Column(
            children: [
              const Text('未搜索到相关内容。', style: TextStyle(color: AppTheme.textSecondary)),
              if (outcome.hasFailures) ...[
                const SizedBox(height: 12),
                for (final entry in outcome.failures.entries)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text(
                      '${entry.key}：${entry.value}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppTheme.danger, fontSize: 12),
                    ),
                  ),
              ],
            ],
          ),
        ),
      );
    }

    final sourceCounts = <String, ({String name, int count})>{};
    for (final item in outcome.items) {
      final id = item.pluginId ?? '';
      if (id.isEmpty) continue;
      final prev = sourceCounts[id];
      sourceCounts[id] = (name: item.pluginName ?? id, count: (prev?.count ?? 0) + 1);
    }
    final activeFilter = _resultSourceFilter != null && sourceCounts.containsKey(_resultSourceFilter)
        ? _resultSourceFilter
        : null;
    final visibleItems = activeFilter == null
        ? outcome.items
        : outcome.items.where((item) => item.pluginId == activeFilter).toList();

    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      sliver: SliverList(
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            if (index == 0) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(LucideIcons.listFilter, size: 14, color: AppTheme.primary),
                        const SizedBox(width: 6),
                        Text(
                          activeFilter == null
                              ? '共 ${outcome.items.length} 条结果 · 点击来源可单独筛选'
                              : '${sourceCounts[activeFilter]!.name} · ${visibleItems.length} 条结果',
                          style: const TextStyle(
                            color: AppTheme.textSecondary,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    if (sourceCounts.length > 1) ...[
                      const SizedBox(height: 10),
                      SingleChildScrollView(
                        key: const Key('result-source-filter-bar'),
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: ChoiceChip(
                                key: const Key('result-source-all'),
                                label: Text('全部结果 (${outcome.items.length})'),
                                selected: activeFilter == null,
                                selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                                onSelected: (_) => setState(() => _resultSourceFilter = null),
                              ),
                            ),
                            for (final entry in sourceCounts.entries)
                              Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: ChoiceChip(
                                  key: Key('result-source-${entry.key}'),
                                  label: Text('${entry.value.name} (${entry.value.count})'),
                                  selected: activeFilter == entry.key,
                                  selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                                  onSelected: (_) => setState(() {
                                    _resultSourceFilter =
                                        _resultSourceFilter == entry.key ? null : entry.key;
                                  }),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              );
            }
            final itemIndex = index - 1;
            if (itemIndex == visibleItems.length) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final entry in outcome.failures.entries)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Text(
                          '${entry.key}：${entry.value}',
                          style: const TextStyle(color: AppTheme.danger, fontSize: 11),
                        ),
                      ),
                  ],
                ),
              );
            }
            final item = visibleItems[itemIndex];
            return _buildResultCard(item);
          },
          childCount: 1 + visibleItems.length + (outcome.hasFailures ? 1 : 0),
        ),
      ),
    );
  }

  Widget _buildSourceExploreSection({required String pluginId, required String mediaType}) {
    final tabsAsync = ref.watch(sourceExploreTabsProvider(pluginId));
    return tabsAsync.when(
      loading: () => const SliverToBoxAdapter(
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 48),
          child: Center(child: CircularProgressIndicator(color: AppTheme.primary)),
        ),
      ),
      error: (err, _) => SliverToBoxAdapter(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text('读取来源榜单失败：$err', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
        ),
      ),
      data: (tabs) {
        if (tabs.isEmpty) {
          return const SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 36, horizontal: 24),
              child: Text(
                '该来源暂未提供官网榜单/发现页，请在上方输入关键词或点击热门标签搜索。',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
              ),
            ),
          );
        }
        final activeTab = _selectedExploreTab != null && tabs.contains(_selectedExploreTab)
            ? _selectedExploreTab!
            : tabs.first;
        final exploreAsync = ref.watch(
          sourceExploreItemsProvider((pluginId: pluginId, tab: activeTab, mediaType: mediaType)),
        );
        return SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          sliver: SliverList(
            delegate: SliverChildListDelegate([
              Row(
                children: [
                  const Icon(LucideIcons.flame, size: 15, color: AppTheme.primary),
                  const SizedBox(width: 6),
                  const Text(
                    '官网发现 / 榜单',
                    style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              SingleChildScrollView(
                key: const Key('explore-tabs-bar'),
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final tab in tabs)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          key: Key('explore-tab-$tab'),
                          label: Text(tab),
                          selected: tab == activeTab,
                          selectedColor: AppTheme.primary.withValues(alpha: 0.25),
                          onSelected: (_) => setState(() => _selectedExploreTab = tab),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              exploreAsync.when(
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: Center(child: CircularProgressIndicator(color: AppTheme.primary)),
                ),
                error: (err, _) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  child: Text('加载「$activeTab」失败：$err',
                      style: const TextStyle(color: AppTheme.danger, fontSize: 12)),
                ),
                data: (items) => items.isEmpty
                    ? const Padding(
                        padding: EdgeInsets.symmetric(vertical: 24),
                        child: Text('该榜单暂无内容。', style: TextStyle(color: AppTheme.textSecondary)),
                      )
                    : Column(
                        children: [for (final item in items) _buildResultCard(item)],
                      ),
              ),
            ]),
          ),
        );
      },
    );
  }

  Widget _buildResultCard(MediaItem item) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radius2XL),
        border: Border.all(color: AppTheme.surfaceLight),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(AppTheme.radius2XL),
        onTap: () {
          context.push('/detail/${Uri.encodeComponent(item.pluginId ?? '')}/${Uri.encodeComponent(item.id)}');
        },
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: const BorderRadius.horizontal(
                left: Radius.circular(AppTheme.radius2XL),
              ),
              child: CachedNetworkImage(
                imageUrl: item.cover,
                width: 96,
                height: 132,
                fit: BoxFit.cover,
                placeholder: (context, url) => Container(
                  color: AppTheme.surfaceLight,
                  child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                ),
                errorWidget: (context, url, error) => Container(
                  color: AppTheme.surfaceLight,
                  child: const Icon(Icons.broken_image, color: AppTheme.textSecondary),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            item.title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 15,
                              height: 1.25,
                              color: AppTheme.textPrimary,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: AppTheme.primary.withValues(alpha: 0.14),
                            borderRadius: BorderRadius.circular(AppTheme.radiusMD),
                            border: Border.all(
                              color: AppTheme.primary.withValues(alpha: 0.35),
                            ),
                          ),
                          child: Text(
                            item.pluginName ?? '未知源',
                            style: const TextStyle(
                              fontSize: 10,
                              color: AppTheme.primaryHover,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if ((item.description ?? '').trim().isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        item.description!.trim(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          height: 1.35,
                          color: AppTheme.textSecondary,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildWebDavEntry(BuildContext context) {
    return Material(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(AppTheme.radius2XL),
      child: InkWell(
        key: const Key('home-webdav-entry'),
        borderRadius: BorderRadius.circular(AppTheme.radius2XL),
        onTap: () => context.push('/webdav'),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.secondary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(AppTheme.radiusXL),
                ),
                child: const Icon(LucideIcons.cloud, color: AppTheme.secondary, size: 20),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('WebDAV 同步',
                        style: TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
                    SizedBox(height: 2),
                    Text('手机直连网盘同步收藏与进度，不需要电脑',
                        style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              const Icon(LucideIcons.chevronRight, color: AppTheme.textSecondary, size: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildKazumiEntry(BuildContext context) {
    final enabled = ref.watch(unifiedEnabledCountProvider);
    return Material(
      color: AppTheme.surface,
      borderRadius: BorderRadius.circular(AppTheme.radius2XL),
      child: InkWell(
        key: const Key('home-sources-entry'),
        borderRadius: BorderRadius.circular(AppTheme.radius2XL),
        onTap: () => context.push('/sources'),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: AppTheme.primary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(AppTheme.radiusXL),
                ),
                child: const Icon(LucideIcons.layers, color: AppTheme.primary, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('来源配置',
                        style: TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
                    const SizedBox(height: 2),
                    Text('动漫、漫画来源统一管理，已启用 $enabled 个',
                        style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                  ],
                ),
              ),
              const Icon(LucideIcons.chevronRight, color: AppTheme.textSecondary, size: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCategoryCard(
    BuildContext context,
    MediaTypeFilter filter,
    MediaTypeFilter selectedType,
    String title,
    IconData icon,
    String count,
    Color accentColor,
  ) {
    return GestureDetector(
      key: Key('category-card-${filter.name}'),
      onTap: () => _selectType(filter),
      child: Container(
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: filter == selectedType ? accentColor : AppTheme.surfaceLight),
        ),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: accentColor.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, color: accentColor, size: 20),
                ),
                const Icon(LucideIcons.chevronRight, color: AppTheme.textSecondary, size: 16),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                      fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white),
                ),
                const SizedBox(height: 2),
                Text(count, style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
