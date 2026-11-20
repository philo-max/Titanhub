import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/network/mainland_channel.dart';
import '../../core/sandbox/local_plugin_runner.dart';
import '../../core/sources/local_sources.dart';
import '../../core/sources/unified/source_health.dart';
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
              const _SourceHealthCard(),
              const SizedBox(height: 12),
              const _MainlandChannelCard(),
              const SizedBox(height: 12),
              for (final kind in SourceKind.values)
                if (kind != SourceKind.movie) _KindCard(kind: kind),
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

class _SourceHealthCard extends ConsumerStatefulWidget {
  const _SourceHealthCard();

  @override
  ConsumerState<_SourceHealthCard> createState() => _SourceHealthCardState();
}

class _SourceHealthCardState extends ConsumerState<_SourceHealthCard> {
  bool _probing = false;
  int _completed = 0;
  int _total = 0;
  List<SourceHealthResult> _results = const [];

  Future<void> _runProbe() async {
    if (_probing) return;
    final active = ref.read(activeSourcesProvider);
    final runner = ref.read(localPluginRunnerProvider);
    setState(() {
      _probing = true;
      _completed = 0;
      _total = active.length;
      _results = const [];
    });
    final results = await probeAllSources(
      sources: active,
      runner: runner,
      onProgress: (_, completed, total) {
        if (!mounted) return;
        setState(() {
          _completed = completed;
          _total = total;
        });
      },
    );
    if (!mounted) return;
    setState(() {
      _probing = false;
      _results = results;
    });
  }

  Future<void> _disableFailed() async {
    final failedIds = {
      for (final r in _results)
        if (r.status == SourceHealthStatus.failed) r.id,
    };
    if (failedIds.isEmpty) return;
    final controller = ref.read(unifiedSourceControllerProvider);
    for (final id in failedIds) {
      await controller.setEnabled(id, false);
    }
    ref
        .read(enabledSourceIdsProvider.notifier)
        .update((s) => s.difference(failedIds));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已禁用 ${failedIds.length} 个失效源')),
    );
    setState(() {
      _results = [
        for (final r in _results)
          if (!failedIds.contains(r.id)) r,
      ];
    });
  }

  @override
  Widget build(BuildContext context) {
    final healthyCount =
        _results.where((r) => r.status == SourceHealthStatus.healthy).length;
    final emptyCount =
        _results.where((r) => r.status == SourceHealthStatus.empty).length;
    final failedCount =
        _results.where((r) => r.status == SourceHealthStatus.failed).length;

    return Card(
      color: AppTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppTheme.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(LucideIcons.activity, color: AppTheme.accent, size: 18),
                const SizedBox(width: 8),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('自动源健康巡检',
                          style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.textPrimary)),
                      SizedBox(height: 2),
                      Text('并发测速已启用的搜索源，自动识别超时/403/空结果源。',
                          style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                    ],
                  ),
                ),
                FilledButton.tonalIcon(
                  key: const Key('source-health-probe'),
                  onPressed: _probing ? null : _runProbe,
                  icon: _probing
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(LucideIcons.radar, size: 14),
                  label: Text(_probing
                      ? '巡检 $_completed/$_total'
                      : '一键巡检可用源'),
                ),
              ],
            ),
            if (_results.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    '✅ 可用 $healthyCount · ⚠️ 空结果 $emptyCount · ❌ 失效 $failedCount',
                    style: const TextStyle(fontSize: 12, color: AppTheme.textSecondary),
                  ),
                  if (failedCount > 0)
                    TextButton.icon(
                      key: const Key('source-health-disable-failed'),
                      onPressed: _disableFailed,
                      icon: const Icon(LucideIcons.shieldOff, size: 14),
                      label: Text('一键禁用失效源 ($failedCount)'),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 220),
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: _results.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 4),
                  itemBuilder: (context, index) {
                    final r = _results[index];
                    final icon = switch (r.status) {
                      SourceHealthStatus.healthy => '✅',
                      SourceHealthStatus.empty => '⚠️',
                      SourceHealthStatus.failed => '❌',
                    };
                    final detail = switch (r.status) {
                      SourceHealthStatus.healthy => '${r.resultCount} 条 · ${r.latencyMs}ms',
                      SourceHealthStatus.empty =>
                        '${r.error ?? '0 条'} · ${r.latencyMs}ms',
                      SourceHealthStatus.failed =>
                        '${r.error ?? '失效'} · ${r.latencyMs}ms',
                    };
                    return Row(
                      children: [
                        Text(icon, style: const TextStyle(fontSize: 12)),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            r.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12, color: AppTheme.textPrimary),
                          ),
                        ),
                        Text(detail,
                            style: const TextStyle(
                                fontSize: 11, color: AppTheme.textSecondary)),
                      ],
                    );
                  },
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MainlandChannelCard extends ConsumerWidget {
  const _MainlandChannelCard();

  Future<void> _editRelayUrl(BuildContext context, WidgetRef ref) async {
    final current = ref.read(edgeRelayUrlProvider) ?? '';
    final controller = TextEditingController(text: current);
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('可选边缘中转加速地址',
            style: TextStyle(color: AppTheme.textPrimary, fontSize: 16)),
        content: TextField(
          controller: controller,
          style: const TextStyle(color: AppTheme.textPrimary, fontSize: 13),
          decoration: const InputDecoration(
            hintText: '如 https://your-worker.workers.dev/?url=',
            hintStyle: TextStyle(color: AppTheme.textSecondary, fontSize: 12),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, ''),
            child: const Text('清空'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('保存'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (result != null) {
      ref.read(edgeRelayUrlProvider.notifier).state =
          result.isEmpty ? null : result;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(mainlandChannelEnabledProvider);
    final relay = ref.watch(edgeRelayUrlProvider);
    return Card(
      key: const Key('mainland-channel-card'),
      color: AppTheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: AppTheme.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(LucideIcons.globe, color: AppTheme.accent, size: 18),
                const SizedBox(width: 8),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('大陆直连网络通道',
                          style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: AppTheme.textPrimary)),
                      SizedBox(height: 2),
                      Text('优先阿里/腾讯 DoH (223.5.5.5 / 1.12.12.12) 与 jsDelivr/gh-proxy 镜像。',
                          style: TextStyle(fontSize: 11, color: AppTheme.textSecondary)),
                    ],
                  ),
                ),
                Switch(
                  value: enabled,
                  activeThumbColor: AppTheme.primary,
                  onChanged: (v) {
                    MainlandHttpOverrides.enabled = v;
                    ref.read(mainlandChannelEnabledProvider.notifier).state = v;
                  },
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: Text(
                    relay == null || relay.isEmpty
                        ? '边缘中转代理：未配置（海外被墙源可选填）'
                        : '边缘中转代理：$relay',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: AppTheme.textSecondary),
                  ),
                ),
                TextButton(
                  onPressed: () => _editRelayUrl(context, ref),
                  child: const Text('配置中转', style: TextStyle(fontSize: 12)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
