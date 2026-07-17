import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../media/providers/media_providers.dart';
import '../../tracking/sync_provider.dart';
import '../../tracking/auth_dialog.dart';
import '../../../core/network/api_client.dart';
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

  void _showServerConfigDialog() {
    final currentUrl = ref.read(serverUrlProvider);
    final textController = TextEditingController(text: currentUrl);

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: AppTheme.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusLG),
            side: const BorderSide(color: AppTheme.border, width: 1),
          ),
          title: const Row(
            children: [
              Icon(Icons.dns, color: AppTheme.primary),
              SizedBox(width: 8),
              Text(
                '配置服务器 URL',
                style: TextStyle(color: AppTheme.textPrimary, fontSize: 18, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '请输入后端 API 服务器的完整 HTTP 地址。如果是本地开发服务器，确保手机与电脑在同一局域网下，并使用电脑的局域网 IP (如 http://192.168.x.x:3001)。',
                style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: textController,
                style: const TextStyle(color: AppTheme.textPrimary),
                decoration: const InputDecoration(
                  labelText: '服务器 URL',
                  labelStyle: TextStyle(color: AppTheme.textSecondary),
                  enabledBorder: UnderlineInputBorder(
                    borderSide: BorderSide(color: AppTheme.border),
                  ),
                  focusedBorder: UnderlineInputBorder(
                    borderSide: BorderSide(color: AppTheme.primary),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
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
                  if (context.mounted) {
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text('服务器 URL 已更新为: $newUrl'),
                        backgroundColor: AppTheme.primary,
                      ),
                    );
                    ref.invalidate(pluginsListProvider);
                  }
                }
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
    final searchResults = ref.watch(searchMediaProvider(_searchQuery));
    final backendStatus = ref.watch(pluginsListProvider);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Row(
          children: [
            Icon(Icons.bolt, color: AppTheme.primary),
            SizedBox(width: 8),
            Text(
              'Titanhub',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                letterSpacing: 1.1,
              ),
            ),
          ],
        ),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          Consumer(
            builder: (context, ref, child) {
              final token = ref.watch(authTokenProvider);
              return IconButton(
                icon: Icon(
                  token != null ? Icons.account_circle : Icons.person_outline,
                  color: token != null ? AppTheme.primary : AppTheme.textSecondary,
                ),
                onPressed: () {
                  showDialog(
                    context: context,
                    builder: (context) => const AuthDialog(),
                  );
                },
              );
            },
          ),
          GestureDetector(
            onTap: _showServerConfigDialog,
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
                  const Icon(Icons.circle, color: AppTheme.success, size: 8),
                  const SizedBox(width: 6),
                  backendStatus.when(
                    data: (list) => Text(
                      'Online (${list.length})',
                      style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                    ),
                    error: (_, __) => const Text(
                      'Offline',
                      style: TextStyle(fontSize: 11, color: AppTheme.danger),
                    ),
                    loading: () => const SizedBox(
                      width: 10,
                      height: 10,
                      child: CircularProgressIndicator(strokeWidth: 1.5),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
      body: CustomScrollView(
        slivers: [
          // Hero & Search Input block
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
                  
                  // Search Bar
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
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),

          // Search results listing
          if (_searchQuery.isNotEmpty)
            searchResults.when(
              data: (results) {
                if (results.isEmpty) {
                  return const SliverToBoxAdapter(
                    child: Center(
                      child: Padding(
                        padding: EdgeInsets.symmetric(vertical: 64.0),
                        child: Text(
                          '未搜索到相关动漫内容。',
                          style: TextStyle(color: AppTheme.textSecondary),
                        ),
                      ),
                    ),
                  );
                }
                return SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) {
                        final item = results[index];
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
                              context.push('/detail/${item.pluginId}/${item.id}');
                            },
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Cover Image on left
                                ClipRRect(
                                  borderRadius: const BorderRadius.horizontal(
                                    left: Radius.circular(15),
                                  ),
                                  child: CachedNetworkImage(
                                    imageUrl: item.cover,
                                    width: 100,
                                    height: 135,
                                    fit: BoxFit.cover,
                                    placeholder: (context, url) => Container(
                                      color: AppTheme.surfaceLight,
                                      child: const Center(
                                        child: CircularProgressIndicator(strokeWidth: 2),
                                      ),
                                    ),
                                    errorWidget: (context, url, error) => Container(
                                      color: AppTheme.surfaceLight,
                                      child: const Icon(Icons.broken_image, color: AppTheme.textSecondary),
                                    ),
                                  ),
                                ),
                                // Text metadata on right
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
                                                  fontSize: 12,
                                                  color: AppTheme.textSecondary,
                                                ),
                                              ),
                                            ],
                                          ),
                                          Row(
                                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                            children: [
                                              Text(
                                                'ID: ${item.id}',
                                                style: const TextStyle(fontSize: 10, color: AppTheme.textTertiary),
                                              ),
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: AppTheme.primary.withOpacity(0.1),
                                                  borderRadius: BorderRadius.circular(AppTheme.radiusMD),
                                                  border: Border.all(
                                                    color: AppTheme.primary.withOpacity(0.3),
                                                  ),
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
                      childCount: results.length,
                    ),
                  ),
                );
              },
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
                          '正在隔离沙箱中加载并执行 JS 解析脚本...',
                          style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          
          // Fallback Category grid on empty search
          if (_searchQuery.isEmpty)
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              sliver: SliverGrid.count(
                crossAxisCount: 2,
                mainAxisSpacing: 16,
                crossAxisSpacing: 16,
                childAspectRatio: 1.4,
                children: [
                  _buildCategoryCard(context, '动漫 (Anime)', LucideIcons.film, '30,000+ 部', AppTheme.primary),
                  _buildCategoryCard(context, '漫画 (Manga)', LucideIcons.bookOpen, '50,000+ 本', Colors.cyanAccent),
                  _buildCategoryCard(context, '轻小说 (Novel)', LucideIcons.fileText, '15,000+ 卷', Colors.pinkAccent),
                  _buildCategoryCard(context, '影视 (Movie)', LucideIcons.tv, '10,000+ 部', Colors.amberAccent),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildCategoryCard(
    BuildContext context,
    String title,
    IconData icon,
    String count,
    Color accentColor,
  ) {
    return Container(
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.surfaceLight),
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
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white),
              ),
              const SizedBox(height: 2),
              Text(
                count,
                style: const TextStyle(fontSize: 10, color: AppTheme.textSecondary),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
