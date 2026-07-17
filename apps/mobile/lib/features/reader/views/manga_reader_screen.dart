import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
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

class _MangaReaderScreenState extends ConsumerState<MangaReaderScreen> {
  final TransformationController _transformationController = TransformationController();
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  @override
  void dispose() {
    _transformationController.dispose();
    super.dispose();
  }

  void _resetZoom() {
    _transformationController.value = Matrix4.identity();
  }

  @override
  Widget build(BuildContext context) {
    // Record reading progress when the pages load successfully
    ref.listen(mangaPagesProvider((
      pluginId: widget.pluginId,
      chapterId: widget.chapterId
    )), (prev, next) {
      next.whenData((images) {
        ref.read(syncServiceProvider).saveProgress(
          mediaId: widget.mediaId,
          pluginId: widget.pluginId,
          mediaType: 'manga',
          chapterNo: 1,
          chapterId: widget.chapterId,
          progress: 1.0,
          status: 'watching',
        );
      });
    });

    final imagesAsync = ref.watch(mangaPagesProvider((
      pluginId: widget.pluginId,
      chapterId: widget.chapterId
    )));
    final chaptersAsync = ref.watch(mediaChaptersProvider((
      pluginId: widget.pluginId,
      mediaId: widget.mediaId
    )));

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: Colors.black,
      endDrawer: _buildChaptersDrawer(chaptersAsync.value ?? []),
      appBar: AppBar(
        title: Text(
          widget.chapterId,
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
        ),
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft, color: Colors.white),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(LucideIcons.zoomOut, color: Colors.white),
            onPressed: _resetZoom,
          ),
          IconButton(
            icon: const Icon(LucideIcons.menu, color: Colors.white),
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

          // Use InteractiveViewer to support smooth pinch to zoom and panning
          return InteractiveViewer(
            transformationController: _transformationController,
            minScale: 1.0,
            maxScale: 4.0,
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(vertical: 8),
              itemCount: images.length,
              itemBuilder: (context, index) {
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  child: Column(
                    children: [
                      CachedNetworkImage(
                        imageUrl: images[index],
                        fit: BoxFit.contain,
                        placeholder: (context, url) => Container(
                          height: 300,
                          color: AppTheme.surface,
                          child: const Center(
                            child: CircularProgressIndicator(color: AppTheme.primary),
                          ),
                        ),
                        errorWidget: (context, url, error) => Container(
                          height: 200,
                          color: AppTheme.surface,
                          child: const Icon(LucideIcons.image, color: AppTheme.textSecondary),
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
                );
              },
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
                        context.pop(); // Close drawer
                        context.pushReplacement(
                          '/manga-read/${widget.pluginId}/${widget.mediaId}/${ch.id}',
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
