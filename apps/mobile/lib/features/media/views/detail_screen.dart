import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../providers/media_providers.dart';
import '../models/media_models.dart';
import '../widgets/episode_selector.dart';
import '../../../core/identity/media_identity.dart';
import '../../../core/playback/chapter_groups.dart';
import '../../../core/router/app_router.dart';
import '../../../core/sources/local_sources.dart';
import '../../../core/sources/media_source.dart';
import '../../tracking/sync_provider.dart';

class DetailScreen extends ConsumerWidget {
  final String pluginId;
  final String mediaId;

  const DetailScreen({
    super.key,
    required this.pluginId,
    required this.mediaId,
  });

  String _mediaType(WidgetRef ref) {
    final source = ref.watch(sourceByIdProvider(pluginId));
    return resolveMediaType(types: source?.types, mediaId: mediaId);
  }

  void _openChapter(BuildContext context, WidgetRef ref, String chapterId, {String? groupId}) {
    final source = ref.read(sourceByIdProvider(pluginId));
    if (source == null) {
      _toast(context, '本机未安装来源「$pluginId」。');
      return;
    }
    if (source.supports(MediaCapability.images)) {
      context.push(readLocation(
        route: 'manga-read',
        pluginId: pluginId,
        mediaId: mediaId,
        chapterId: chapterId,
      ));
    } else if (source.supports(MediaCapability.content)) {
      context.push(readLocation(
        route: 'novel-read',
        pluginId: pluginId,
        mediaId: mediaId,
        chapterId: chapterId,
      ));
    } else if (source.supports(MediaCapability.video)) {
      context.push(playLocation(
        pluginId: pluginId,
        mediaId: mediaId,
        chapterId: chapterId,
        groupId: groupId,
      ));
    } else {
      _toast(context, '来源「${source.name}」只提供资料与章节，没有可播放/可阅读内容。');
    }
  }

  void _toast(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppTheme.surfaceElevated),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final arg = (pluginId: pluginId, mediaId: mediaId);
    final detailAsync = ref.watch(mediaDetailProvider(arg));
    final chaptersAsync = ref.watch(mediaChaptersProvider(arg));
    final source = ref.watch(sourceByIdProvider(pluginId));
    final identity = MediaIdentity(
      pluginId: pluginId,
      mediaType: _mediaType(ref),
      mediaId: mediaId,
    );

    return Scaffold(
      backgroundColor: AppTheme.background,
      body: detailAsync.when(
        data: (detail) => CustomScrollView(
          slivers: [
            SliverAppBar(
              expandedHeight: 300,
              backgroundColor: Colors.transparent,
              elevation: 0,
              pinned: true,
              leading: IconButton(
                icon: const Icon(LucideIcons.arrowLeft, color: Colors.white),
                tooltip: '返回',
                onPressed: () => context.pop(),
              ),
              actions: [
                ref.watch(favoriteStatusProvider(identity)).when(
                      data: (isFav) => IconButton(
                        tooltip: isFav ? '取消收藏' : '收藏',
                        icon: Icon(
                          LucideIcons.bookmark,
                          color: isFav ? AppTheme.primary : Colors.white,
                        ),
                        onPressed: () async {
                          final sync = ref.read(syncServiceProvider);
                          await sync.setFavorite(identity, !isFav);
                          if (!context.mounted) return;
                          _toast(context, isFav ? '已取消收藏' : '已加入收藏');
                        },
                      ),
                      loading: () => const SizedBox(),
                      error: (_, __) => const SizedBox(),
                    ),
              ],
              flexibleSpace: FlexibleSpaceBar(
                background: Stack(
                  fit: StackFit.expand,
                  children: [
                    CachedNetworkImage(
                      imageUrl: detail.cover,
                      fit: BoxFit.cover,
                      errorWidget: (_, __, ___) => const SizedBox(),
                    ),
                    Container(color: Colors.black.withOpacity(0.5)),
                    Container(
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [Colors.transparent, AppTheme.background],
                        ),
                      ),
                    ),
                    Align(
                      alignment: Alignment.bottomCenter,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 24),
                        width: 140,
                        height: 195,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.5),
                              blurRadius: 15,
                              offset: const Offset(0, 10),
                            ),
                          ],
                          border: Border.all(color: AppTheme.surfaceLight),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(15),
                          child: CachedNetworkImage(
                            imageUrl: detail.cover,
                            fit: BoxFit.cover,
                            placeholder: (_, __) => Container(color: Colors.grey[900]),
                            errorWidget: (_, __, ___) => Container(
                              color: Colors.grey[900],
                              child: const Icon(LucideIcons.imageOff, color: AppTheme.textSecondary),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Center(
                      child: Text(
                        detail.title,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    if (source != null) ...[
                      const SizedBox(height: 8),
                      Center(
                        child: Text(
                          '${source.name} · ${source.capabilitySummary}',
                          style: const TextStyle(fontSize: 11, color: AppTheme.textTertiary),
                        ),
                      ),
                      if (!source.supports(MediaCapability.video) &&
                          !source.supports(MediaCapability.images) &&
                          !source.supports(MediaCapability.content)) ...[
                        const SizedBox(height: 12),
                        _AutoMatchedSourceBar(title: detail.title),
                        const SizedBox(height: 10),
                        Center(
                          child: Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            alignment: WrapAlignment.center,
                            children: [
                              OutlinedButton.icon(
                                key: const Key('detail-search-playable'),
                                onPressed: () {
                                  context.push(Uri(
                                    path: '/search',
                                    queryParameters: {
                                      'type': MediaTypeFilter.anime.name,
                                      'q': detail.title,
                                    },
                                  ).toString());
                                },
                                icon: const Icon(LucideIcons.play, size: 15),
                                label: const Text('搜此番播放源'),
                              ),
                              OutlinedButton.icon(
                                key: const Key('detail-search-novel'),
                                onPressed: () {
                                  context.push(Uri(
                                    path: '/search',
                                    queryParameters: {
                                      'type': MediaTypeFilter.novel.name,
                                      'q': detail.title,
                                    },
                                  ).toString());
                                },
                                icon: const Icon(LucideIcons.bookOpen, size: 15),
                                label: const Text('搜此书小说源'),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ],
                    const SizedBox(height: 16),
                    Center(
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        children: detail.genres.map((genre) {
                          return ActionChip(
                            label: Text(
                              genre,
                              style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                            ),
                            backgroundColor: AppTheme.surface,
                            side: const BorderSide(color: AppTheme.surfaceLight),
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            onPressed: () {
                              final isManga = source?.types.contains('manga') == true;
                              final isNovel = source?.types.contains('novel') == true;
                              final targetType = isManga
                                  ? MediaTypeFilter.manga
                                  : isNovel
                                      ? MediaTypeFilter.novel
                                      : MediaTypeFilter.anime;
                              final params = <String, String>{
                                'type': targetType.name,
                                'q': 'tag:$genre',
                                if (isManga || isNovel) 'source': pluginId,
                              };
                              context.push(Uri(path: '/search', queryParameters: params).toString());
                            },
                          );
                        }).toList(),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: const BoxDecoration(
                        border: Border(
                          top: BorderSide(color: AppTheme.surfaceLight),
                          bottom: BorderSide(color: AppTheme.surfaceLight),
                        ),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: [
                          Flexible(
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(LucideIcons.user, size: 16, color: AppTheme.primary),
                                const SizedBox(width: 8),
                                Flexible(
                                  child: Text(
                                    '作者: ${detail.author ?? '未知'}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          Flexible(
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(LucideIcons.calendar, size: 16, color: Colors.cyanAccent),
                                const SizedBox(width: 8),
                                Flexible(
                                  child: Text(
                                    '更新: ${detail.lastUpdate ?? '最近'}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(fontSize: 13, color: AppTheme.textSecondary),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    ref.watch(trackingProvider(identity)).when(
                          data: (track) {
                            if (track == null || track.chapterId == null) return const SizedBox();
                            return Container(
                              margin: const EdgeInsets.only(bottom: 20),
                              decoration: BoxDecoration(
                                color: AppTheme.primary.withOpacity(0.05),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: AppTheme.primary.withOpacity(0.2)),
                              ),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(12),
                                onTap: () => _openChapter(context, ref, track.chapterId!),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Row(
                                    children: [
                                      const Icon(LucideIcons.history,
                                          color: AppTheme.primary, size: 20),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            const Text(
                                              '上次看至',
                                              style: TextStyle(
                                                  color: AppTheme.textSecondary, fontSize: 10),
                                            ),
                                            Text(
                                              track.chapterTitle ?? '最近章节',
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 13,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                            if (track.progress > 0)
                                              Text(
                                                '进度 ${(track.progress * 100).clamp(0, 100).toStringAsFixed(0)}%',
                                                style: const TextStyle(
                                                  color: AppTheme.textSecondary,
                                                  fontSize: 10,
                                                ),
                                              ),
                                          ],
                                        ),
                                      ),
                                      const Icon(LucideIcons.chevronRight,
                                          color: AppTheme.primary, size: 16),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                          loading: () => const SizedBox(),
                          error: (_, __) => const SizedBox(),
                        ),
                    const Text(
                      '作品简介',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppTheme.surface.withOpacity(0.5),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: AppTheme.surface),
                      ),
                      child: Text(
                        detail.description ?? '暂无简介。',
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppTheme.textSecondary,
                          height: 1.5,
                        ),
                      ),
                    ),
                    const SizedBox(height: 28),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(LucideIcons.circlePlay, color: AppTheme.primary, size: 20),
                        SizedBox(width: 8),
                        Text(
                          '选集 / 章节',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    chaptersAsync.when(
                      data: (chapters) {
                        if (chapters.isEmpty) {
                          return const Center(
                            child: Padding(
                              padding: EdgeInsets.symmetric(vertical: 24),
                              child: Text('该来源未返回章节。',
                                  style: TextStyle(color: AppTheme.textSecondary)),
                            ),
                          );
                        }
                        if (source?.supports(MediaCapability.video) ?? false) {
                          return EpisodeSelector(
                            lines: groupChapterLines(chapters),
                            activeChapterId:
                                ref.watch(trackingProvider(identity)).valueOrNull?.chapterId,
                            onSelect: (chapter, line) => _openChapter(
                              context,
                              ref,
                              chapter.id,
                              groupId: line.id,
                            ),
                          );
                        }
                        return GridView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          padding: EdgeInsets.zero,
                          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: MediaQuery.sizeOf(context).width < 380 ? 1 : 2,
                            childAspectRatio: 2.8,
                            crossAxisSpacing: 12,
                            mainAxisSpacing: 12,
                          ),
                          itemCount: chapters.length,
                          itemBuilder: (context, index) {
                            final Chapter ch = chapters[index];
                            return Container(
                              decoration: BoxDecoration(
                                color: AppTheme.surface,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: AppTheme.surfaceLight),
                              ),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(12),
                                onTap: () => _openChapter(context, ref, ch.id),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 16.0),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Text(
                                          ch.title,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600,
                                            color: AppTheme.textSecondary,
                                          ),
                                        ),
                                      ),
                                      Icon(
                                        (source?.supports(MediaCapability.content) ?? false)
                                            ? LucideIcons.bookOpen
                                            : ((source?.supports(MediaCapability.images) ?? false)
                                                ? LucideIcons.bookImage
                                                : LucideIcons.play),
                                        size: 13,
                                        color: AppTheme.primary,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                        );
                      },
                      loading: () => const Center(
                        child: Padding(
                          padding: EdgeInsets.symmetric(vertical: 24),
                          child: CircularProgressIndicator(color: AppTheme.primary),
                        ),
                      ),
                      error: (err, _) => Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 24),
                          child: Text('加载章节失败: $err',
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: AppTheme.danger)),
                        ),
                      ),
                    ),
                    const SizedBox(height: 60),
                  ],
                ),
              ),
            ),
          ],
        ),
        loading: () => const Center(
          child: CircularProgressIndicator(color: AppTheme.primary),
        ),
        error: (err, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(LucideIcons.circleHelp, size: 48, color: AppTheme.danger),
              const SizedBox(height: 16),
              const Text('加载作品失败',
                  style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24.0),
                child: Text('$err',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppTheme.textSecondary)),
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
    );
  }
}

class _AutoMatchedSourceBar extends ConsumerWidget {
  const _AutoMatchedSourceBar({required this.title});

  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final matchesAsync = ref.watch(autoMatchedSourcesProvider(title));
    return matchesAsync.when(
      loading: () => const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.primary),
          ),
          SizedBox(width: 8),
          Text(
            '正在自动匹配可用播放/阅读源…',
            style: TextStyle(fontSize: 12, color: AppTheme.textSecondary),
          ),
        ],
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (matches) {
        if (matches.isEmpty) return const SizedBox.shrink();
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppTheme.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppTheme.primary.withValues(alpha: 0.45)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Row(
                children: [
                  Icon(LucideIcons.sparkles, size: 15, color: AppTheme.primary),
                  SizedBox(width: 6),
                  Text(
                    '已自动接通可用源 · 点击直达播放/阅读',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppTheme.textPrimary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  for (final item in matches)
                    if (item.pluginId != null && item.pluginId!.isNotEmpty)
                      FilledButton.tonalIcon(
                        key: Key('auto-match-${item.pluginId}'),
                        onPressed: () => context.push(
                          '/detail/${Uri.encodeComponent(item.pluginId!)}/${Uri.encodeComponent(item.id)}',
                        ),
                        icon: const Icon(LucideIcons.zap, size: 14),
                        label: Text(
                          item.pluginName ?? item.pluginId!,
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}
