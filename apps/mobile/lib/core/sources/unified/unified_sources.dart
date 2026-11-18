import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../kazumi/kazumi_manager.dart';
import '../kazumi/kazumi_models.dart';
import '../kazumi/kazumi_providers.dart';
import '../market/market_infra.dart';
import '../venera/venera_catalog.dart';
import '../venera/venera_manager.dart';
import '../venera/venera_models.dart';
import '../venera/venera_policy.dart';
import '../venera/venera_providers.dart';
import 'catalog_format.dart';
import 'source_kind.dart';
import 'unified_models.dart';

const String veneraIdPrefix = 'venera-';
const int subscriptionIndexMaxBytes = 2 * 1024 * 1024;

class UnifiedKindView {
  const UnifiedKindView({
    this.sources = const [],
    this.available = const [],
    this.loaded = false,
    this.busy = false,
    this.busyMessage = '',
    this.error,
    this.report,
    this.loadErrors = const {},
    this.catalogUrl = '',
    this.catalogLoaded = false,
    this.showAdult = false,
    this.supportsAdult = false,
  });

  final List<UnifiedSource> sources;
  final List<UnifiedAvailable> available;
  final bool loaded;
  final bool busy;
  final String busyMessage;
  final String? error;
  final UnifiedReport? report;
  final Map<String, String> loadErrors;
  final String catalogUrl;
  final bool catalogLoaded;
  final bool showAdult;
  final bool supportsAdult;

  int get enabledCount => sources.where((s) => s.enabled).length;

  int get updatableCount => sources.where((s) => s.tags.contains(SourceTag.updatable)).length;

  List<UnifiedSource> get regular => [for (final s in sources) if (!s.adult) s];

  List<UnifiedSource> get adult => [for (final s in sources) if (s.adult) s];
}

UnifiedReport _reportOf(MarketInstallReport report) => UnifiedReport.fromMarketReport(report);

UnifiedKindView _animeView(KazumiSourcesState state) {
  final entries = state.catalog?.entries ?? const <KazumiCatalogEntry>[];
  final catalogVersions = {for (final entry in entries) entry.id: entry.version};
  final installedIds = {for (final item in state.installed) item.id};
  final lastReport = state.lastReport;
  return UnifiedKindView(
    sources: [
      for (final item in state.installed)
        UnifiedSource(
          id: item.id,
          name: item.name,
          version: item.version,
          kind: SourceKind.anime,
          enabled: item.enabled,
          tags: [
            if (catalogVersions.containsKey(item.id) &&
                compareSourceVersions(item.version, catalogVersions[item.id]!) < 0)
              SourceTag.updatable,
          ],
        ),
    ],
    available: [
      for (final entry in entries)
        if (!installedIds.contains(entry.id))
          UnifiedAvailable(id: entry.id, name: entry.name, version: entry.version, kind: SourceKind.anime),
    ],
    loaded: state.loaded,
    busy: state.busy,
    busyMessage: state.busyMessage,
    error: state.error,
    report: lastReport == null
        ? null
        : UnifiedReport.fromMarket(
            items: [
              for (final item in lastReport.items)
                (name: item.name, status: item.status.name, message: item.message),
            ],
            origin: lastReport.catalogOrigin,
            warnings: lastReport.catalogWarnings,
          ).withEnabled(state.lastEnabled),
    loadErrors: state.loadErrors,
    catalogUrl: state.catalogUrl,
    catalogLoaded: state.catalog != null,
  );
}

UnifiedKindView _mangaView(VeneraSourcesState state) {
  final entries = state.catalog?.entries ?? const <VeneraCatalogEntry>[];
  final catalogVersions = {for (final entry in entries) entry.id: entry.version};
  final installedIds = {for (final item in state.installed) item.id};
  final lastReport = state.lastReport;
  return UnifiedKindView(
    sources: [
      for (final item in state.installed)
        UnifiedSource(
          id: item.id,
          name: item.name,
          version: item.version,
          kind: SourceKind.manga,
          enabled: item.enabled,
          configurable: item.hints.hasSettings || item.hints.hasAccount,
          tags: [
            if (isAdultVeneraKey(item.key)) SourceTag.adult,
            if (veneraNeedsLogin(item.key)) SourceTag.needsLogin,
            if (veneraNeedsConfig(item.key)) SourceTag.needsConfig,
            SourceTag.experimental,
            if (catalogVersions.containsKey(item.id) &&
                compareSourceVersions(item.version, catalogVersions[item.id]!) < 0)
              SourceTag.updatable,
          ],
        ),
    ],
    available: [
      for (final entry in entries)
        if (!installedIds.contains(entry.id))
          UnifiedAvailable(
            id: entry.id,
            name: entry.name,
            version: entry.version,
            kind: SourceKind.manga,
            adult: isAdultVeneraKey(entry.key),
          ),
    ],
    loaded: state.loaded,
    busy: state.busy,
    busyMessage: state.busyMessage,
    error: state.error,
    report: lastReport == null ? null : _reportOf(lastReport).withEnabled(state.lastEnabled),
    loadErrors: state.loadErrors,
    catalogUrl: state.catalogUrl,
    catalogLoaded: state.catalog != null,
    showAdult: state.showAdult,
    supportsAdult: true,
  );
}

final unifiedKindViewProvider = Provider.family<UnifiedKindView, SourceKind>((ref, kind) {
  switch (kind) {
    case SourceKind.anime:
      return _animeView(ref.watch(kazumiSourcesProvider));
    case SourceKind.manga:
      return _mangaView(ref.watch(veneraSourcesProvider));
    case SourceKind.novel:
    case SourceKind.movie:
      return const UnifiedKindView(loaded: true);
  }
});

final unifiedEnabledCountProvider = Provider<int>((ref) {
  return ref.watch(unifiedKindViewProvider(SourceKind.anime)).enabledCount +
      ref.watch(unifiedKindViewProvider(SourceKind.manga)).enabledCount;
});

final subscriptionFetcherProvider = Provider<MirrorFetcher>((ref) => MirrorFetcher());

class UnifiedSourceController {
  UnifiedSourceController(this._ref);

  final Ref _ref;

  KazumiSourcesNotifier get _kazumi => _ref.read(kazumiSourcesProvider.notifier);
  VeneraSourcesNotifier get _venera => _ref.read(veneraSourcesProvider.notifier);

  Future<void> installRecommended(SourceKind kind) async {
    switch (kind) {
      case SourceKind.anime:
        await _kazumi.installAll();
      case SourceKind.manga:
        await _venera.installRecommended();
      case SourceKind.novel:
      case SourceKind.movie:
        return;
    }
  }

  Future<void> checkUpdates(SourceKind kind) async {
    switch (kind) {
      case SourceKind.anime:
        await _kazumi.refreshCatalog();
      case SourceKind.manga:
        await _venera.refreshCatalog();
      case SourceKind.novel:
      case SourceKind.movie:
        return;
    }
  }

  Future<void> updateAll(SourceKind kind) async {
    switch (kind) {
      case SourceKind.anime:
        await _kazumi.updateInstalled();
      case SourceKind.manga:
        await _venera.updateInstalled();
      case SourceKind.novel:
      case SourceKind.movie:
        return;
    }
  }

  Future<void> install(String id) =>
      id.startsWith(veneraIdPrefix) ? _venera.installOne(id) : _kazumi.installOne(id);

  Future<void> setEnabled(String id, bool enabled) => id.startsWith(veneraIdPrefix)
      ? _venera.setEnabled(id, enabled)
      : _kazumi.setEnabled(id, enabled);

  Future<void> uninstall(String id) =>
      id.startsWith(veneraIdPrefix) ? _venera.uninstall(id) : _kazumi.uninstall(id);

  Future<void> setShowAdult(bool value) => _venera.setShowAdult(value);

  Future<void> setCatalogUrl(SourceKind kind, String input) {
    switch (kind) {
      case SourceKind.anime:
        return _kazumi.setCatalogUrl(input);
      case SourceKind.manga:
        return _venera.setCatalogUrl(input);
      case SourceKind.novel:
      case SourceKind.movie:
        return Future.value();
    }
  }

  Future<String?> importSubscription(SourceKind kind, String input) async {
    final base = normalizeCatalogBase(input);
    if (base == null) return '订阅地址必须是 HTTPS，且不能包含账号、查询串或片段';
    final MirrorFetched fetched;
    try {
      fetched = await _ref.read(subscriptionFetcherProvider).fetch(
            [base],
            'index.json',
            maxBytes: subscriptionIndexMaxBytes,
          );
    } catch (error) {
      return '无法读取订阅目录：$error';
    }
    final format = detectCatalogFormat(fetched.json);
    final detected = format.kind;
    if (detected == null) {
      return '无法识别订阅格式：该地址下的 index.json 不是受支持的来源目录';
    }
    if (detected != kind) {
      return '该订阅包含的是${detected.label}来源，请到「${detected.title}」中导入';
    }
    final warnings = <String>[];
    switch (format) {
      case CatalogFormat.rules:
        final entries = <KazumiCatalogEntry>[];
        final seen = <String>{};
        for (final item in fetched.json as List) {
          try {
            final entry = KazumiCatalogEntry.fromIndexEntry(item, fetched.base);
            if (seen.add(entry.id)) entries.add(entry);
          } catch (error) {
            warnings.add('忽略无效目录条目：$error');
          }
        }
        if (entries.isEmpty) return '订阅目录没有任何有效条目';
        await _kazumi.installFrom(KazumiCatalog(
          entries: entries,
          origin: fetched.base,
          downloadBase: fetched.base,
          warnings: warnings,
        ));
      case CatalogFormat.scripts:
        final entries = parseVeneraIndex(fetched.json, fetched.base, warnings: warnings);
        if (entries.isEmpty) return '订阅目录没有任何有效条目';
        await _venera.installFrom(VeneraCatalog(
          entries: entries,
          origin: fetched.base,
          downloadBase: fetched.base,
          warnings: warnings,
        ));
      case CatalogFormat.unknown:
        return '无法识别订阅格式：该地址下的 index.json 不是受支持的来源目录';
    }
    return null;
  }
}

final unifiedSourceControllerProvider =
    Provider<UnifiedSourceController>((ref) => UnifiedSourceController(ref));
