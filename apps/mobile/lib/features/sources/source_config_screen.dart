import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/sources/kazumi/kazumi_catalog.dart';
import '../../core/sources/unified/source_kind.dart';
import '../../core/sources/unified/unified_models.dart';
import '../../core/sources/unified/unified_sources.dart';
import '../../core/sources/venera/venera_catalog.dart';
import '../../core/theme/app_theme.dart';
import 'source_config_panels.dart';
import 'source_tiles.dart';

const double _maxContentWidth = 640;

class SourceConfigScreen extends ConsumerStatefulWidget {
  const SourceConfigScreen({super.key, required this.kind});

  final SourceKind kind;

  @override
  ConsumerState<SourceConfigScreen> createState() => _SourceConfigScreenState();
}

class _SourceConfigScreenState extends ConsumerState<SourceConfigScreen> {
  final _catalogController = TextEditingController();
  final _importController = TextEditingController();
  String _syncedCatalogUrl = '';
  String? _importError;
  bool _importing = false;

  SourceKind get _kind => widget.kind;

  UnifiedSourceController get _controller => ref.read(unifiedSourceControllerProvider);

  @override
  void dispose() {
    _catalogController.dispose();
    _importController.dispose();
    super.dispose();
  }

  Future<void> _import() async {
    setState(() {
      _importing = true;
      _importError = null;
    });
    final error = await _controller.importSubscription(_kind, _importController.text);
    if (!mounted) return;
    setState(() {
      _importing = false;
      _importError = error;
    });
    if (error == null) _importController.clear();
  }

  Future<void> _toggle(UnifiedSource source, bool value) async {
    if (value && source.adult) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          key: const Key('adult-confirm'),
          title: const Text('启用成人向来源'),
          content: Text('「${source.name}」可能包含成人内容，请确认你已年满 18 岁并自愿启用。启用后它会参与${_kind.label}搜索。'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('取消'),
            ),
            FilledButton(
              key: const Key('adult-confirm-ok'),
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('确认启用'),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
    }
    await _controller.setEnabled(source.id, value);
  }

  int get _defaultMirrors =>
      _kind == SourceKind.anime ? defaultKazumiCatalogBases.length : defaultVeneraCatalogBases.length;

  @override
  Widget build(BuildContext context) {
    final view = ref.watch(unifiedKindViewProvider(_kind));
    if (view.catalogUrl != _syncedCatalogUrl) {
      _syncedCatalogUrl = view.catalogUrl;
      _catalogController.text = view.catalogUrl;
    }
    final available = [
      for (final item in view.available)
        if (!item.adult || view.showAdult) item,
    ];
    final hiddenAdult = view.adult.length + view.available.where((a) => a.adult).length;
    return Scaffold(
      appBar: AppBar(title: Text(_kind.title)),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: _maxContentWidth),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildActions(view),
              SourceUrlPanel(
                title: '导入订阅地址',
                description: '粘贴 HTTPS 目录地址（目录下需有 index.json），自动识别格式并安装其中的来源。',
                fieldKey: const Key('source-import-url'),
                controller: _importController,
                hint: 'https://example.com/sources/',
                error: _importError,
                actions: [
                  FilledButton(
                    key: const Key('source-import'),
                    onPressed: _importing || view.busy ? null : _import,
                    child: Text(_importing ? '导入中…' : '导入'),
                  ),
                ],
              ),
              SourceUrlPanel(
                title: '默认目录地址（可选）',
                description: catalogDescription(view.catalogUrl, _defaultMirrors),
                fieldKey: const Key('source-catalog-url'),
                controller: _catalogController,
                hint: 'https://example.com/rules/',
                actions: [
                  FilledButton(
                    key: const Key('source-catalog-save'),
                    onPressed: view.busy
                        ? null
                        : () => _controller.setCatalogUrl(_kind, _catalogController.text),
                    child: const Text('保存'),
                  ),
                  TextButton(
                    key: const Key('source-catalog-reset'),
                    onPressed: view.busy
                        ? null
                        : () {
                            _catalogController.clear();
                            _controller.setCatalogUrl(_kind, '');
                          },
                    child: const Text('恢复默认镜像'),
                  ),
                ],
              ),
              if (view.error != null) SourceNotice(view.error!, AppTheme.danger),
              if (view.report != null) SourceReportPanel(view.report!),
              if (view.loadErrors.isNotEmpty)
                SourceNotice(
                  '有 ${view.loadErrors.length} 个已安装来源无法加载：${view.loadErrors.entries.map((e) => '${e.key}（${e.value}）').join('；')}',
                  AppTheme.warning,
                ),
              if (view.supportsAdult) _buildAdultSwitch(view, hiddenAdult),
              const SizedBox(height: 16),
              Text('已安装（${view.regular.length}）',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              if (view.regular.isEmpty && view.loaded)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text('尚未安装任何来源，点击上方“一键安装推荐来源”。',
                      style: TextStyle(color: AppTheme.textTertiary, fontSize: 12)),
                ),
              for (final source in view.regular) _installedTile(source, view.busy),
              if (view.showAdult && view.adult.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text('成人向来源（${view.adult.length}）',
                    key: const Key('source-adult-section'),
                    style: const TextStyle(color: AppTheme.danger, fontWeight: FontWeight.bold)),
                for (final source in view.adult) _installedTile(source, view.busy),
              ],
              if (available.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text('可安装（${available.length}）',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                for (final item in available)
                  AvailableSourceTile(
                    source: item,
                    busy: view.busy,
                    onInstall: () => _controller.install(item.id),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _installedTile(UnifiedSource source, bool busy) {
    return InstalledSourceTile(
      source: source,
      busy: busy,
      onToggle: (value) => _toggle(source, value),
      onUninstall: () => _controller.uninstall(source.id),
      onSettings: source.configurable
          ? () => context.push('/sources/${_kind.slug}/${Uri.encodeComponent(source.id)}/settings')
          : null,
    );
  }

  Widget _buildAdultSwitch(UnifiedKindView view, int hiddenAdult) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      decoration: panelDecoration(),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('显示成人向来源',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                Text(
                  view.showAdult
                      ? '已显示，需逐个手动启用；关闭后会停用全部成人向来源。'
                      : '默认隐藏并停用（共 $hiddenAdult 个），打开后才能逐个启用。',
                  style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
                ),
              ],
            ),
          ),
          Switch(
            key: const Key('source-show-adult'),
            value: view.showAdult,
            activeColor: AppTheme.primary,
            onChanged: view.busy ? null : _controller.setShowAdult,
          ),
        ],
      ),
    );
  }

  Widget _buildActions(UnifiedKindView view) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: panelDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('来源在本机运行，安装与更新只走公开镜像或内置快照，不依赖电脑。',
              style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
          if (view.catalogLoaded)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                view.updatableCount > 0 ? '有 ${view.updatableCount} 个来源可更新' : '已是最新，没有可更新的来源',
                key: const Key('source-update-hint'),
                style: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
              ),
            ),
          const SizedBox(height: 12),
          if (view.busy)
            BusyRow(view.busyMessage)
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton(
                  key: const Key('source-install-recommended'),
                  onPressed: () => _controller.installRecommended(_kind),
                  child: const Text('一键安装推荐来源'),
                ),
                OutlinedButton(
                  key: const Key('source-check-updates'),
                  onPressed: () => _controller.checkUpdates(_kind),
                  child: const Text('检查更新'),
                ),
                OutlinedButton(
                  key: const Key('source-update-all'),
                  onPressed: view.sources.isEmpty ? null : () => _controller.updateAll(_kind),
                  child: const Text('全部更新'),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
