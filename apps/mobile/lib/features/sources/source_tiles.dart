import 'package:flutter/material.dart';

import '../../core/sources/unified/unified_models.dart';
import '../../core/theme/app_theme.dart';

Color _tagColor(SourceTag tag) {
  switch (tag) {
    case SourceTag.adult:
      return AppTheme.danger;
    case SourceTag.needsConfig:
    case SourceTag.needsLogin:
      return AppTheme.warning;
    case SourceTag.updatable:
      return AppTheme.success;
    case SourceTag.experimental:
      return AppTheme.textTertiary;
  }
}

class SourceTagChip extends StatelessWidget {
  const SourceTagChip(this.tag, {super.key});

  final SourceTag tag;

  @override
  Widget build(BuildContext context) {
    final color = _tagColor(tag);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(AppTheme.radiusSM),
      ),
      child: Text(tag.label, style: TextStyle(color: color, fontSize: 10)),
    );
  }
}

class InstalledSourceTile extends StatelessWidget {
  const InstalledSourceTile({
    super.key,
    required this.source,
    required this.busy,
    required this.onToggle,
    required this.onUninstall,
    this.onSettings,
  });

  final UnifiedSource source;
  final bool busy;
  final ValueChanged<bool> onToggle;
  final VoidCallback onUninstall;
  final VoidCallback? onSettings;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: Key('source-tile-${source.id}'),
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.fromLTRB(16, 10, 8, 6),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(source.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Colors.white, fontSize: 14)),
                    const SizedBox(height: 2),
                    Text('v${source.version} · ${source.enabled ? '已启用' : '已停用'}',
                        key: Key('source-status-${source.id}'),
                        style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
                  ],
                ),
              ),
              Switch(
                key: Key('source-switch-${source.id}'),
                value: source.enabled,
                activeColor: AppTheme.primary,
                onChanged: busy ? null : onToggle,
              ),
            ],
          ),
          if (source.tags.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 8, bottom: 4),
              child: Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [for (final tag in source.tags) SourceTagChip(tag)],
              ),
            ),
          Align(
            alignment: Alignment.centerRight,
            child: Wrap(
              children: [
                if (onSettings != null)
                  TextButton(
                    key: Key('source-settings-${source.id}'),
                    onPressed: busy ? null : onSettings,
                    child: const Text('设置/登录'),
                  ),
                TextButton(
                  key: Key('source-uninstall-${source.id}'),
                  onPressed: busy ? null : onUninstall,
                  child: const Text('卸载'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class AvailableSourceTile extends StatelessWidget {
  const AvailableSourceTile({
    super.key,
    required this.source,
    required this.busy,
    required this.onInstall,
  });

  final UnifiedAvailable source;
  final bool busy;
  final VoidCallback onInstall;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: Key('source-available-${source.id}'),
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(source.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontSize: 14)),
                Text('v${source.version}',
                    style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
              ],
            ),
          ),
          if (source.adult) const SourceTagChip(SourceTag.adult),
          TextButton(
            key: Key('source-install-${source.id}'),
            onPressed: busy ? null : onInstall,
            child: const Text('安装'),
          ),
        ],
      ),
    );
  }
}
