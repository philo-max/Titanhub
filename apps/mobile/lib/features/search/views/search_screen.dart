import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../media/providers/media_providers.dart';
import '../../tracking/sync_provider.dart';
import '../../tracking/auth_dialog.dart';
import '../../../core/network/api_client.dart';
import '../../../core/sources/unified/unified_sources.dart';
import '../../../core/sources/local_sources.dart';
import '../../../core/sources/media_source.dart';
import '../../../core/theme/app_theme.dart';

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  void _performSearch() {
    setState(() {
      _searchQuery = _searchController.text.trim();
    });
  }

  void _selectType(MediaTypeFilter filter) {
    ref.read(selectedMediaTypeProvider.notifier).state = filter;
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
                      value: remoteEnabled,
                      activeColor: AppTheme.primary,
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
    final selectedType = ref.watch(selectedMediaTypeProvider);
    final searchResults =
        ref.watch(searchMediaProvider((query: _searchQuery, type: selectedType)));
    final activeSources = ref.watch(activeSourcesProvider);
    final typeSources = ref.watch(searchSourcesProvider(selectedType));
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
                  Text(
                    typeSources.isNotEmpty
                        ? '本机来源：${typeSources.map((s) => s.name).join('、')}'
                        : selectedType == MediaTypeFilter.all
                            ? '当前没有启用任何本机来源，点右上角选择来源。'
                            : '「${selectedType.label}」分类没有已启用的本机来源，点右上角选择来源。',
                    style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
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
          if (_searchQuery.isEmpty)
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

    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      sliver: SliverList(
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            if (index == outcome.items.length) {
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
            final item = outcome.items[index];
            return Container(
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: AppTheme.surface,
                borderRadius: BorderRadius.circular(AppTheme.radius2XL),
                border: Border.all(color: AppTheme.surfaceLight),
              ),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () {
                  context.push('/detail/${Uri.encodeComponent(item.pluginId ?? '')}/${Uri.encodeComponent(item.id)}');
                },
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ClipRRect(
                      borderRadius: const BorderRadius.horizontal(left: Radius.circular(15)),
                      child: CachedNetworkImage(
                        imageUrl: item.cover,
                        width: 100,
                        height: 135,
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
                        padding: const EdgeInsets.all(16.0),
                        child: SizedBox(
                          height: 103,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    item.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                      fontSize: 16,
                                      color: AppTheme.textPrimary,
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    item.description ?? '',
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontSize: 12, color: AppTheme.textSecondary),
                                  ),
                                ],
                              ),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'ID: ${item.id}',
                                    style: const TextStyle(
                                        fontSize: 10, color: AppTheme.textTertiary),
                                  ),
                                  Container(
                                    padding:
                                        const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: AppTheme.primary.withOpacity(0.1),
                                      borderRadius:
                                          BorderRadius.circular(AppTheme.radiusMD),
                                      border: Border.all(
                                          color: AppTheme.primary.withOpacity(0.3)),
                                    ),
                                    child: Text(
                                      item.pluginName ?? '未知源',
                                      style: const TextStyle(
                                        fontSize: 9,
                                        color: AppTheme.primaryHover,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
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
              ),
            );
          },
          childCount: outcome.items.length + (outcome.hasFailures ? 1 : 0),
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
