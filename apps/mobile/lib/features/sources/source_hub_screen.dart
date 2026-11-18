import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/sources/unified/source_kind.dart';
import '../../core/sources/unified/unified_sources.dart';
import '../../core/theme/app_theme.dart';

const double _maxContentWidth = 640;

const Map<SourceKind, IconData> _kindIcons = {
  SourceKind.anime: LucideIcons.tv,
  SourceKind.manga: LucideIcons.bookOpen,
  SourceKind.novel: LucideIcons.fileText,
  SourceKind.movie: LucideIcons.film,
};

class SourceHubScreen extends ConsumerWidget {
  const SourceHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('来源配置')),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: _maxContentWidth),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('来源在手机本机运行，安装与更新走公开镜像或内置快照，不依赖电脑。',
                  style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
              const SizedBox(height: 12),
              for (final kind in SourceKind.values) _KindCard(kind: kind),
            ],
          ),
        ),
      ),
    );
  }
}

class _KindCard extends ConsumerWidget {
  const _KindCard({required this.kind});

  final SourceKind kind;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final view = ref.watch(unifiedKindViewProvider(kind));
    final available = kind.available;
    final subtitle = available
        ? '已安装 ${view.sources.length} 个 · 已启用 ${view.enabledCount} 个'
        : '即将支持';
    final foreground = available ? Colors.white : AppTheme.textTertiary;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radius2XL),
        child: InkWell(
          key: Key('source-kind-${kind.slug}'),
          borderRadius: BorderRadius.circular(AppTheme.radius2XL),
          onTap: available ? () => context.push('/sources/${kind.slug}') : null,
          child: Opacity(
            opacity: available ? 1 : 0.5,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: (available ? AppTheme.primary : AppTheme.textTertiary).withOpacity(0.12),
                      borderRadius: BorderRadius.circular(AppTheme.radiusXL),
                    ),
                    child: Icon(_kindIcons[kind],
                        color: available ? AppTheme.primary : AppTheme.textTertiary, size: 20),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(kind.title,
                            style: TextStyle(
                                fontWeight: FontWeight.bold, fontSize: 14, color: foreground)),
                        const SizedBox(height: 2),
                        Text(subtitle,
                            key: Key('source-kind-subtitle-${kind.slug}'),
                            style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                      ],
                    ),
                  ),
                  if (available)
                    const Icon(LucideIcons.chevronRight, color: AppTheme.textSecondary, size: 16),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
