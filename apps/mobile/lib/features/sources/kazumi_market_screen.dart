import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/sources/kazumi/kazumi_catalog.dart';
import '../../core/sources/kazumi/kazumi_manager.dart';
import '../../core/sources/kazumi/kazumi_models.dart';
import '../../core/sources/kazumi/kazumi_providers.dart';
import '../../core/theme/app_theme.dart';

const double _maxContentWidth = 640;

class KazumiMarketScreen extends ConsumerStatefulWidget {
  const KazumiMarketScreen({super.key});

  @override
  ConsumerState<KazumiMarketScreen> createState() => _KazumiMarketScreenState();
}

class _KazumiMarketScreenState extends ConsumerState<KazumiMarketScreen> {
  final _catalogController = TextEditingController();
  String _syncedCatalogUrl = '';

  @override
  void dispose() {
    _catalogController.dispose();
    super.dispose();
  }

  KazumiSourcesNotifier get _notifier => ref.read(kazumiSourcesProvider.notifier);

  String _originLabel(String origin) =>
      origin == kazumiSnapshotOrigin ? '内置快照（离线）' : Uri.tryParse(origin)?.host ?? origin;

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(kazumiSourcesProvider);
    if (state.catalogUrl != _syncedCatalogUrl) {
      _syncedCatalogUrl = state.catalogUrl;
      _catalogController.text = state.catalogUrl;
    }
    final installedIds = {for (final item in state.installed) item.id};
    final available = [
      for (final entry in state.catalog?.entries ?? const <KazumiCatalogEntry>[])
        if (!installedIds.contains(entry.id)) entry,
    ];
    return Scaffold(
      appBar: AppBar(title: const Text('Kazumi 动漫来源')),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: _maxContentWidth),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildActions(state),
              const SizedBox(height: 12),
              _buildCatalogUrl(state),
              if (state.error != null) _notice(state.error!, AppTheme.danger),
              if (state.lastReport != null) _buildReport(state.lastReport!),
              if (state.loadErrors.isNotEmpty)
                _notice(
                  '有 ${state.loadErrors.length} 个已安装规则无法加载：${state.loadErrors.entries.map((e) => '${e.key}（${e.value}）').join('；')}',
                  AppTheme.warning,
                ),
              const SizedBox(height: 16),
              Text('已安装（${state.installed.length}）',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              if (state.installed.isEmpty && state.loaded)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text('尚未安装任何规则来源，点击上方“一键安装/更新全部”。',
                      style: TextStyle(color: AppTheme.textTertiary, fontSize: 12)),
                ),
              for (final item in state.installed) _buildInstalledTile(item, state.busy),
              if (available.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text('可安装（${available.length}）',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                for (final entry in available) _buildAvailableTile(entry, state.busy),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActions(KazumiSourcesState state) {
    final catalog = state.catalog;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radius2XL),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('全部规则在本机运行，安装与更新只走公开镜像或内置快照，不依赖电脑。',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
          if (catalog != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('目录来源：${_originLabel(catalog.origin)} · ${catalog.entries.length} 个规则',
                  style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
            ),
          const SizedBox(height: 12),
          if (state.busy)
            Row(
              children: [
                const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                const SizedBox(width: 8),
                Text(state.busyMessage,
                    style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
              ],
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton(
                  key: const Key('kazumi-install-all'),
                  onPressed: _notifier.installAll,
                  child: const Text('一键安装/更新全部'),
                ),
                OutlinedButton(
                  key: const Key('kazumi-update'),
                  onPressed: state.installed.isEmpty ? null : _notifier.updateInstalled,
                  child: const Text('检查更新'),
                ),
                OutlinedButton(
                  key: const Key('kazumi-refresh'),
                  onPressed: _notifier.refreshCatalog,
                  child: const Text('刷新目录'),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildCatalogUrl(KazumiSourcesState state) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radius2XL),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('自定义目录地址（可选）',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
          const SizedBox(height: 4),
          Text(
            state.catalogUrl.isEmpty
                ? '当前使用内置 ${defaultKazumiCatalogBases.length} 个镜像，依次回退。仅支持 HTTPS，目录下需有 index.json。'
                : '当前使用自定义目录：${state.catalogUrl}',
            style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('kazumi-catalog-url'),
            controller: _catalogController,
            keyboardType: TextInputType.url,
            style: const TextStyle(color: Colors.white, fontSize: 13),
            decoration: const InputDecoration(hintText: 'https://example.com/KazumiRules/'),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              FilledButton(
                key: const Key('kazumi-catalog-save'),
                onPressed: state.busy ? null : () => _notifier.setCatalogUrl(_catalogController.text),
                child: const Text('保存'),
              ),
              const SizedBox(width: 8),
              TextButton(
                onPressed: state.busy
                    ? null
                    : () {
                        _catalogController.clear();
                        _notifier.setCatalogUrl('');
                      },
                child: const Text('恢复默认镜像'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _notice(String message, Color color) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
      ),
      child: Text(message, style: TextStyle(color: color, fontSize: 12)),
    );
  }

  Widget _buildReport(KazumiInstallReport report) {
    final failures = report.failures;
    return Container(
      key: const Key('kazumi-report'),
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('结果：${report.summary}',
              style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
          Text('目录来源：${_originLabel(report.catalogOrigin)}',
              style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
          for (final warning in report.catalogWarnings)
            Text(warning, style: const TextStyle(color: AppTheme.warning, fontSize: 11)),
          for (final item in report.items)
            if (item.status != KazumiInstallStatus.failed &&
                item.status != KazumiInstallStatus.upToDate &&
                item.message.isNotEmpty)
              Text('${item.name}：${item.message}',
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
          for (final item in failures)
            Text('${item.name} 失败：${item.message}',
                style: const TextStyle(color: AppTheme.danger, fontSize: 11)),
        ],
      ),
    );
  }

  Widget _buildInstalledTile(InstalledKazumiSource item, bool busy) {
    return Container(
      key: Key('kazumi-installed-${item.id}'),
      margin: const EdgeInsets.only(top: 8),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
      ),
      child: ListTile(
        title: Text(item.name, style: const TextStyle(color: Colors.white, fontSize: 14)),
        subtitle: Text(
          'v${item.version} · ${item.type == 'movie' ? '影视' : '动漫'} · ${item.origin == kazumiSnapshotOrigin ? '内置快照' : '镜像'}',
          style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Switch(
              key: Key('kazumi-switch-${item.id}'),
              value: item.enabled,
              activeColor: AppTheme.primary,
              onChanged: busy ? null : (value) => _notifier.setEnabled(item.id, value),
            ),
            IconButton(
              key: Key('kazumi-uninstall-${item.id}'),
              tooltip: '卸载',
              icon: const Icon(Icons.delete_outline, color: AppTheme.textSecondary),
              onPressed: busy ? null : () => _notifier.uninstall(item.id),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildAvailableTile(KazumiCatalogEntry entry, bool busy) {
    return Container(
      margin: const EdgeInsets.only(top: 8),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
      ),
      child: ListTile(
        title: Text(entry.name, style: const TextStyle(color: Colors.white, fontSize: 14)),
        subtitle: Text('v${entry.version}',
            style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
        trailing: TextButton(
          onPressed: busy ? null : () => _notifier.installOne(entry.id),
          child: const Text('安装'),
        ),
      ),
    );
  }
}
