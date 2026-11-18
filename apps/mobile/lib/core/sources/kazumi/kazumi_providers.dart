import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../../sandbox/local_plugin_runner.dart';
import '../local_sources.dart';
import '../media_source.dart';
import '../seven_se_fun_source.dart';
import 'kazumi_manager.dart';
import 'kazumi_models.dart';
import 'kazumi_store.dart';

final kazumiManagerProvider = FutureProvider<KazumiRuleManager>((ref) async {
  final documents = await getApplicationDocumentsDirectory();
  final store = KazumiRuleStore(Directory(p.join(documents.path, 'kazumi-sources')));
  return KazumiRuleManager(
    store: store,
    reservedIds: {for (final source in bundledSources) source.id, SevenSeFunSource.pluginId},
  );
});

class KazumiSourcesState {
  const KazumiSourcesState({
    this.installed = const [],
    this.loaded = false,
    this.busy = false,
    this.busyMessage = '',
    this.loadErrors = const {},
    this.catalog,
    this.catalogUrl = '',
    this.lastReport,
    this.lastEnabled = 0,
    this.error,
  });

  final List<InstalledKazumiSource> installed;
  final bool loaded;
  final bool busy;
  final String busyMessage;
  final Map<String, String> loadErrors;
  final KazumiCatalog? catalog;
  final String catalogUrl;
  final KazumiInstallReport? lastReport;
  final int lastEnabled;
  final String? error;

  KazumiSourcesState copyWith({
    List<InstalledKazumiSource>? installed,
    bool? loaded,
    bool? busy,
    String? busyMessage,
    Map<String, String>? loadErrors,
    KazumiCatalog? catalog,
    String? catalogUrl,
    KazumiInstallReport? lastReport,
    int? lastEnabled,
    String? error,
    bool clearError = false,
  }) {
    return KazumiSourcesState(
      installed: installed ?? this.installed,
      loaded: loaded ?? this.loaded,
      busy: busy ?? this.busy,
      busyMessage: busyMessage ?? this.busyMessage,
      loadErrors: loadErrors ?? this.loadErrors,
      catalog: catalog ?? this.catalog,
      catalogUrl: catalogUrl ?? this.catalogUrl,
      lastReport: lastReport ?? this.lastReport,
      lastEnabled: lastEnabled ?? this.lastEnabled,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

MediaSource kazumiMediaSource(InstalledKazumiSource source) => MediaSource(
      id: source.id,
      name: source.name,
      types: [source.type],
      capabilities: const {
        MediaCapability.search,
        MediaCapability.detail,
        MediaCapability.chapters,
        MediaCapability.video,
      },
    );

class KazumiSourcesNotifier extends StateNotifier<KazumiSourcesState> {
  KazumiSourcesNotifier(this._ref) : super(const KazumiSourcesState());

  final Ref _ref;

  Future<KazumiRuleManager> _manager() => _ref.read(kazumiManagerProvider.future);

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
    KazumiRuleManager manager, {
    String? catalogUrl,
    KazumiInstallReport? report,
    int enabledNow = 0,
    KazumiCatalog? catalog,
  }) async {
    final loaded = await manager.loadInstalled();
    final runner = _ref.read(localPluginRunnerProvider);
    final previousIds = {for (final item in state.installed) item.id};
    final currentIds = {for (final item in loaded.rules) item.meta.id};
    for (final id in previousIds.difference(currentIds)) {
      runner.unregisterKazumiRule(id);
    }
    for (final item in loaded.rules) {
      runner.registerKazumiRule(item.rule);
    }

    final enabledNotifier = _ref.read(enabledSourceIdsProvider.notifier);
    final enabled = {...enabledNotifier.state};
    for (final id in previousIds.difference(currentIds)) {
      enabled.remove(id);
    }
    for (final item in loaded.rules) {
      if (item.meta.enabled) {
        enabled.add(item.meta.id);
      } else {
        enabled.remove(item.meta.id);
      }
    }
    enabledNotifier.state = enabled;

    final installed = [for (final item in loaded.rules) item.meta];
    _ref.read(installedKazumiSourcesProvider.notifier).state = [
      for (final meta in installed) kazumiMediaSource(meta),
    ];
    state = state.copyWith(
      installed: installed,
      loaded: true,
      busy: false,
      busyMessage: '',
      loadErrors: loaded.errors,
      catalogUrl: catalogUrl,
      lastReport: report,
      lastEnabled: report == null ? null : enabledNow,
      catalog: catalog,
    );
  }

  Future<void> _run(String message, Future<void> Function(KazumiRuleManager manager) action) async {
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
        final report = await manager.installAllFromCatalog();
        final enabledNow = await manager.enableRecommended();
        await _reload(manager, report: report, enabledNow: enabledNow);
      });

  Future<void> updateInstalled() => _run('正在检查更新', (manager) async {
        final report = await manager.installAllFromCatalog(onlyInstalled: true);
        await _reload(manager, report: report);
      });

  Future<void> installOne(String id) => _run('正在安装来源', (manager) async {
        final catalog = state.catalog ?? await manager.fetchCatalog();
        final report = await manager.install(catalog, ids: {id});
        await _reload(manager, report: report, catalog: catalog);
      });

  Future<void> installFrom(KazumiCatalog catalog) => _run('正在导入订阅来源', (manager) async {
        final report = await manager.install(catalog, basesOverride: [catalog.origin]);
        await _reload(manager, report: report);
      });

  Future<void> setEnabled(String id, bool enabled) => _run('正在更新来源状态', (manager) async {
        await manager.setEnabled(id, enabled);
        await _reload(manager);
      });

  Future<void> uninstall(String id) => _run('正在卸载来源', (manager) async {
        await manager.uninstall(id);
        await _reload(manager);
      });

  Future<void> setCatalogUrl(String input) => _run('正在保存目录地址', (manager) async {
        await manager.setCatalogUrl(input);
        final catalogUrl = (await manager.store.readState()).catalogUrl;
        state = KazumiSourcesState(
          installed: state.installed,
          loaded: state.loaded,
          loadErrors: state.loadErrors,
          lastReport: state.lastReport,
          catalogUrl: catalogUrl,
        );
      });
}

final kazumiSourcesProvider =
    StateNotifierProvider<KazumiSourcesNotifier, KazumiSourcesState>(
  (ref) => KazumiSourcesNotifier(ref),
);

final kazumiBootstrapProvider = FutureProvider<void>((ref) async {
  await ref.read(kazumiSourcesProvider.notifier).load();
});
