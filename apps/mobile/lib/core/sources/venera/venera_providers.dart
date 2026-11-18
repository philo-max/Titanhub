import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../sandbox/local_plugin_runner.dart';
import '../../sync/webdav_config_store.dart';
import '../local_sources.dart';
import '../market/market_infra.dart';
import '../media_source.dart';
import 'venera_manager.dart';
import 'venera_models.dart';
import 'venera_policy.dart';
import 'venera_store.dart';

final veneraSecretsProvider = Provider<SecureKeyValue>((ref) => FlutterSecureKeyValue());

final veneraManagerProvider = FutureProvider<VeneraManager>((ref) async {
  final documents = await getApplicationDocumentsDirectory();
  return VeneraManager(
    store: VeneraStore(Directory(p.join(documents.path, 'venera-sources'))),
    secrets: ref.read(veneraSecretsProvider),
  );
});

class VeneraSourcesState {
  const VeneraSourcesState({
    this.installed = const [],
    this.loaded = false,
    this.busy = false,
    this.busyMessage = '',
    this.loadErrors = const {},
    this.catalog,
    this.catalogUrl = '',
    this.showAdult = false,
    this.lastReport,
    this.lastEnabled = 0,
    this.error,
  });

  final List<InstalledVeneraSource> installed;
  final bool loaded;
  final bool busy;
  final String busyMessage;
  final Map<String, String> loadErrors;
  final VeneraCatalog? catalog;
  final String catalogUrl;
  final bool showAdult;
  final MarketInstallReport? lastReport;
  final int lastEnabled;
  final String? error;

  VeneraSourcesState copyWith({
    List<InstalledVeneraSource>? installed,
    bool? loaded,
    bool? busy,
    String? busyMessage,
    Map<String, String>? loadErrors,
    VeneraCatalog? catalog,
    String? catalogUrl,
    bool? showAdult,
    MarketInstallReport? lastReport,
    int? lastEnabled,
    String? error,
    bool clearError = false,
  }) {
    return VeneraSourcesState(
      installed: installed ?? this.installed,
      loaded: loaded ?? this.loaded,
      busy: busy ?? this.busy,
      busyMessage: busyMessage ?? this.busyMessage,
      loadErrors: loadErrors ?? this.loadErrors,
      catalog: catalog ?? this.catalog,
      catalogUrl: catalogUrl ?? this.catalogUrl,
      showAdult: showAdult ?? this.showAdult,
      lastReport: lastReport ?? this.lastReport,
      lastEnabled: lastEnabled ?? this.lastEnabled,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

MediaSource veneraMediaSource(InstalledVeneraSource source) => MediaSource(
      id: source.id,
      name: source.name,
      types: [source.type],
      capabilities: const {
        MediaCapability.search,
        MediaCapability.detail,
        MediaCapability.chapters,
        MediaCapability.images,
      },
    );

class VeneraSourcesNotifier extends StateNotifier<VeneraSourcesState> {
  VeneraSourcesNotifier(this._ref) : super(const VeneraSourcesState());

  final Ref _ref;

  Future<VeneraManager> _manager() => _ref.read(veneraManagerProvider.future);

  Future<void> load() async {
    if (state.busy) return;
    state = state.copyWith(busy: true, busyMessage: '正在加载已安装来源', clearError: true);
    try {
      final manager = await _manager();
      final seedReport = await manager.seedFromSnapshotIfFirstRun();
      final catalogUrl = (await manager.store.readState()).catalogUrl;
      await _reload(manager, catalogUrl: catalogUrl, report: seedReport);
    } catch (error) {
      state = state.copyWith(busy: false, loaded: true, error: '加载来源失败：$error');
    }
  }

  Future<void> _reload(
    VeneraManager manager, {
    String? catalogUrl,
    MarketInstallReport? report,
    int enabledNow = 0,
    VeneraCatalog? catalog,
  }) async {
    final loaded = await manager.loadInstalled();
    final runner = _ref.read(localPluginRunnerProvider);
    final previousIds = {for (final item in state.installed) item.id};
    final currentIds = {for (final item in loaded.sources) item.meta.id};
    for (final id in previousIds.difference(currentIds)) {
      runner.unregisterVeneraSource(id);
    }
    for (final item in loaded.sources) {
      final current = runner.veneraSource(item.meta.id);
      if (current == null || current.meta.version != item.meta.version || current.code != item.code) {
        runner.registerVeneraSource(item.meta, item.code, manager.store, secrets: manager.secrets);
      }
    }

    final enabledNotifier = _ref.read(enabledSourceIdsProvider.notifier);
    final enabled = {...enabledNotifier.state};
    for (final id in previousIds.difference(currentIds)) {
      enabled.remove(id);
    }
    for (final item in loaded.sources) {
      if (item.meta.enabled) {
        enabled.add(item.meta.id);
      } else {
        enabled.remove(item.meta.id);
      }
    }
    enabledNotifier.state = enabled;

    final installed = [for (final item in loaded.sources) item.meta];
    _ref.read(installedVeneraSourcesProvider.notifier).state = [
      for (final meta in installed) veneraMediaSource(meta),
    ];
    state = state.copyWith(
      installed: installed,
      loaded: true,
      busy: false,
      busyMessage: '',
      loadErrors: loaded.errors,
      catalogUrl: catalogUrl,
      showAdult: await manager.showAdult(),
      lastReport: report,
      lastEnabled: report == null ? null : enabledNow,
      catalog: catalog,
    );
  }

  Future<void> _run(String message, Future<void> Function(VeneraManager manager) action) async {
    if (state.busy) return;
    state = state.copyWith(busy: true, busyMessage: message, clearError: true);
    try {
      await action(await _manager());
    } catch (error) {
      state = state.copyWith(busy: false, busyMessage: '', error: '$error');
    }
  }

  Future<void> refreshCatalog() => _run('正在获取目录', (manager) async {
        final catalog = await manager.fetchCatalog();
        state = state.copyWith(busy: false, busyMessage: '', catalog: catalog);
      });

  Future<void> installAll() => _run('正在安装/更新全部来源', (manager) async {
        await _reload(manager, report: await manager.installAllFromCatalog());
      });

  Future<void> installRecommended() => _run('正在安装推荐来源', (manager) async {
        final catalog = await manager.fetchCatalog();
        final report = await manager.install(
          catalog,
          ids: {
            for (final entry in catalog.entries)
              if (!isAdultVeneraKey(entry.key)) entry.id,
          },
        );
        final enabledNow = await manager.enableRecommended();
        await _reload(manager, report: report, catalog: catalog, enabledNow: enabledNow);
      });

  Future<void> updateInstalled() => _run('正在检查更新', (manager) async {
        await _reload(manager, report: await manager.installAllFromCatalog(onlyInstalled: true));
      });

  Future<void> installOne(String id) => _run('正在安装来源', (manager) async {
        final catalog = state.catalog ?? await manager.fetchCatalog();
        final report = await manager.install(catalog, ids: {id});
        await _reload(manager, report: report, catalog: catalog);
      });

  Future<void> setEnabled(String id, bool enabled) => _run('正在更新来源状态', (manager) async {
        await manager.setEnabled(id, enabled);
        await _reload(manager);
      });

  Future<void> uninstall(String id) => _run('正在卸载来源', (manager) async {
        await manager.uninstall(id);
        await _reload(manager);
      });

  Future<void> setShowAdult(bool value) => _run('正在更新显示设置', (manager) async {
        await manager.setShowAdult(value);
        await _reload(manager);
      });

  Future<void> installFrom(VeneraCatalog catalog) => _run('正在导入订阅来源', (manager) async {
        final report = await manager.install(
          catalog,
          enableByDefault: (_) => false,
          basesOverride: [catalog.origin],
        );
        await _reload(manager, report: report);
      });

  Future<void> setCatalogUrl(String input) => _run('正在保存目录地址', (manager) async {
        await manager.setCatalogUrl(input);
        final catalogUrl = (await manager.store.readState()).catalogUrl;
        state = VeneraSourcesState(
          installed: state.installed,
          loaded: state.loaded,
          loadErrors: state.loadErrors,
          lastReport: state.lastReport,
          catalogUrl: catalogUrl,
          showAdult: state.showAdult,
        );
      });
}

final veneraSourcesProvider =
    StateNotifierProvider<VeneraSourcesNotifier, VeneraSourcesState>(
  (ref) => VeneraSourcesNotifier(ref),
);

final veneraBootstrapProvider = FutureProvider<void>((ref) async {
  await ref.read(veneraSourcesProvider.notifier).load();
});
