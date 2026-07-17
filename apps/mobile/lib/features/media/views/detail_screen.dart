import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:drift/drift.dart' show Value;
import '../providers/media_providers.dart';
import '../../../core/storage/app_database.dart';
import '../../tracking/sync_provider.dart';

class DetailScreen extends ConsumerWidget {
  final String pluginId;
  final String mediaId;

  const DetailScreen({
    super.key,
    required this.pluginId,
    required this.mediaId,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detailAsync = ref.watch(mediaDetailProvider((pluginId: pluginId, mediaId: mediaId)));
    final chaptersAsync = ref.watch(mediaChaptersProvider((pluginId: pluginId, mediaId: mediaId)));

    return Scaffold(
      backgroundColor: const Color(0xFF030712), // Slate 950
      body: detailAsync.when(
        data: (detail) => CustomScrollView(
          slivers: [
            // Flexible App Bar with Hero cover image
            SliverAppBar(
              expandedHeight: 300,
              backgroundColor: Colors.transparent,
              elevation: 0,
              pinned: true,
              leading: IconButton(
                icon: const Icon(LucideIcons.arrowLeft, color: Colors.white),
                onPressed: () => context.pop(),
              ),
              actions: [
                ref.watch(isFavoriteProvider(mediaId)).when(
                  data: (isFav) => IconButton(
                    icon: Icon(
                      isFav ? LucideIcons.bookmark : LucideIcons.bookmark,
                      color: isFav ? const Color(0xFF8B5CF6) : Colors.white,
                    ),
                    onPressed: () async {
                      final db = ref.read(databaseProvider);
                      if (isFav) {
                        await db.deleteFavorite(mediaId);
                      } else {
                        await db.saveFavorite(LocalFavoritesCompanion(
                          id: Value(DateTime.now().millisecondsSinceEpoch.toString()),
                          mediaId: Value(mediaId),
                          pluginId: Value(pluginId),
                          mediaType: Value(mediaId.contains('manga') ? 'manga' : mediaId.contains('novel') ? 'novel' : 'anime'),
                        ));
                      }
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
                    // Blur backdrop
                    CachedNetworkImage(
                      imageUrl: detail.cover,
                      fit: BoxFit.cover,
                      errorWidget: (_, __, ___) => const SizedBox(),
                    ),
                    Container(
                      color: Colors.black.withOpacity(0.5),
                    ),
                    // Bottom gradient transition
                    Container(
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.transparent,
                            Color(0xFF030712),
                          ],
                        ),
                      ),
                    ),
                    // Centered poster image
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
                          border: Border.all(color: const Color(0xFF1E293B)),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(15),
                          child: CachedNetworkImage(
                            imageUrl: detail.cover,
                            fit: BoxFit.cover,
                            placeholder: (_, __) => Container(color: Colors.grey[900]),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Metadata Detail block
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title
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
                    const SizedBox(height: 16),

                    // Genres
                    Center(
                      child: Wrap(
                        spacing: 8,
                        children: detail.genres.map((genre) {
                          return Chip(
                            label: Text(
                              genre,
                              style: const TextStyle(fontSize: 11, color: const Color(0xFF64748B)),
                            ),
                            backgroundColor: const Color(0xFF0F172A),
                            side: const BorderSide(color: Color(0xFF1E293B)),
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                          );
                        }).toList(),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Author & Update Grid
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: const BoxDecoration(
                        border: Border(
                          top: BorderSide(color: Color(0xFF1E293B)),
                          bottom: BorderSide(color: Color(0xFF1E293B)),
                        ),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceAround,
                        children: [
                          Row(
                            children: [
                              const Icon(LucideIcons.user, size: 16, color: const Color(0xFF8B5CF6)),
                              const SizedBox(width: 8),
                              Text(
                                '作者: ${detail.author ?? '未知'}',
                                style: const TextStyle(fontSize: 13, color: const Color(0xFF64748B)),
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              const Icon(LucideIcons.calendar, size: 16, color: Colors.cyanAccent),
                              const SizedBox(width: 8),
                              Text(
                                '更新: ${detail.lastUpdate ?? '最近'}',
                                style: const TextStyle(fontSize: 13, color: const Color(0xFF64748B)),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),

                    // Resume Progress Banner
                    ref.watch(lastTrackingProvider(mediaId)).when(
                      data: (track) {
                        if (track == null) return const SizedBox();
                        return Container(
                          margin: const EdgeInsets.only(bottom: 20),
                          decoration: BoxDecoration(
                            color: const Color(0xFF8B5CF6).withOpacity(0.05),
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: const Color(0xFF8B5CF6).withOpacity(0.2)),
                          ),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(12),
                            onTap: () {
                              if (mediaId.contains('manga')) {
                                context.push('/manga-read/$pluginId/$mediaId/${track.chapterId}');
                              } else if (mediaId.contains('novel')) {
                                context.push('/novel-read/$pluginId/$mediaId/${track.chapterId}');
                              } else {
                                context.push('/play/$pluginId/$mediaId/${track.chapterId}');
                              }
                            },
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Row(
                                children: [
                                  const Icon(LucideIcons.history, color: const Color(0xFF8B5CF6), size: 20),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        const Text(
                                          '上次看至',
                                          style: TextStyle(color: const Color(0xFF64748B), fontSize: 10),
                                        ),
                                        Text(
                                          track.chapterId ?? '第一章',
                                          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const Icon(LucideIcons.chevronRight, color: const Color(0xFF8B5CF6), size: 16),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                      loading: () => const SizedBox(),
                      error: (_, __) => const SizedBox(),
                    ),

                    // Description
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
                        color: const Color(0xFF0F172A).withOpacity(0.5),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFF0F172A)),
                      ),
                      child: Text(
                        detail.description ?? '暂无简介。',
                        style: const TextStyle(
                          fontSize: 13,
                          color: const Color(0xFF64748B),
                          height: 1.5,
                        ),
                      ),
                    ),
                    const SizedBox(height: 28),
                  ],
                ),
              ),
            ),

            // Chapters Grid list
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(LucideIcons.playCircle, color: const Color(0xFF8B5CF6), size: 20),
                        SizedBox(width: 8),
                        Text(
                          '选集 / 章节播放',
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
                              child: Text('无可用播放章节。', style: TextStyle(color: const Color(0xFF64748B))),
                            ),
                          );
                        }
                        return GridView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          padding: EdgeInsets.zero,
                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            childAspectRatio: 2.8,
                            crossAxisSpacing: 12,
                            mainAxisSpacing: 12,
                          ),
                          itemCount: chapters.length,
                          itemBuilder: (context, index) {
                            final ch = chapters[index];
                            return Container(
                              decoration: BoxDecoration(
                                color: const Color(0xFF0F172A),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0xFF1E293B)),
                              ),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(12),
                                onTap: () {
                                  if (mediaId.contains('manga')) {
                                    context.push('/manga-read/$pluginId/$mediaId/${ch.id}');
                                  } else if (mediaId.contains('novel')) {
                                    context.push('/novel-read/$pluginId/$mediaId/${ch.id}');
                                  } else {
                                    context.push('/play/$pluginId/$mediaId/${ch.id}');
                                  }
                                },
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
                                            color: const Color(0xFF64748B),
                                          ),
                                        ),
                                      ),
                                      const Icon(
                                        LucideIcons.play,
                                        size: 12,
                                        color: const Color(0xFF8B5CF6),
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
                          child: CircularProgressIndicator(color: const Color(0xFF8B5CF6)),
                        ),
                      ),
                      error: (err, _) => Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 24),
                          child: Text('加载章节失败: $err', style: const TextStyle(color: const Color(0xFFF43F5E))),
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
          child: CircularProgressIndicator(color: const Color(0xFF8B5CF6)),
        ),
        error: (err, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(LucideIcons.helpCircle, size: 48, color: const Color(0xFFF43F5E)),
              const SizedBox(height: 16),
              const Text('加载作品失败', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24.0),
                child: Text('$err', textAlign: TextAlign.center, style: const TextStyle(color: const Color(0xFF64748B))),
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
