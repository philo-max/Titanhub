import '../../sync/webdav_config_store.dart';
import '../market/market_infra.dart';
import 'venera_catalog.dart';
import 'venera_models.dart';
import 'venera_policy.dart';
import 'venera_store.dart';

class VeneraCatalog {
  const VeneraCatalog({
    required this.entries,
    required this.origin,
    required this.downloadBase,
    this.warnings = const [],
  });

  final List<VeneraCatalogEntry> entries;
  final String origin;
  final String downloadBase;
  final List<String> warnings;

  bool get isSnapshot => origin == veneraSnapshotOrigin;
}

class VeneraManager {
  VeneraManager({
    required this.store,
    MirrorFetcher? fetcher,
    VeneraSnapshot? snapshot,
    DateTime Function()? clock,
    this.parallelism = 4,
    this.secrets,
  })  : fetcher = fetcher ?? MirrorFetcher(),
        snapshot = snapshot ?? VeneraSnapshot(),
        _clock = clock ?? DateTime.now;

  final VeneraStore store;
  final MirrorFetcher fetcher;
  final VeneraSnapshot snapshot;
  final int parallelism;
  final SecureKeyValue? secrets;
  final DateTime Function() _clock;

  Future<List<String>> catalogBases() async {
    final custom = (await store.readState()).catalogUrl;
    final normalized = custom.isEmpty ? null : normalizeCatalogBase(custom);
    return normalized == null ? defaultVeneraCatalogBases : [normalized];
  }

  Future<void> setCatalogUrl(String input) async {
    final trimmed = input.trim();
    final state = await store.readState();
    if (trimmed.isEmpty) {
      await store.writeState(VeneraStoreState(seeded: state.seeded, showAdult: state.showAdult));
      return;
    }
    final normalized = normalizeCatalogBase(trimmed);
    if (normalized == null) {
      throw const VeneraException('目录地址必须是 HTTPS，且不能包含账号、查询串或片段');
    }
    await store.writeState(
      VeneraStoreState(seeded: state.seeded, catalogUrl: normalized, showAdult: state.showAdult),
    );
  }

  Future<VeneraStoreLoadResult> loadInstalled() => store.loadAll();

  Future<VeneraCatalog> fetchCatalog() async {
    final bases = await catalogBases();
    final warnings = <String>[];
    try {
      final fetched = await fetcher.fetch(
        bases,
        'index.json',
        maxBytes: veneraMaxIndexBytes,
        validate: (_, json) {
          if (json is! List) throw const VeneraException('目录不是数组');
        },
      );
      final entries = parseVeneraIndex(fetched.json, fetched.base, warnings: warnings);
      if (entries.isEmpty) throw const VeneraException('目录没有任何有效条目');
      return VeneraCatalog(
        entries: entries,
        origin: fetched.base,
        downloadBase: fetched.base,
        warnings: warnings,
      );
    } catch (error) {
      warnings.add('在线目录不可用，已改用内置快照：$error');
      return VeneraCatalog(
        entries: await snapshot.entries(),
        origin: veneraSnapshotOrigin,
        downloadBase: veneraSnapshotSourceDir,
        warnings: warnings,
      );
    }
  }

  Future<MarketInstallReport?> seedFromSnapshotIfFirstRun() async {
    final state = await store.readState();
    if (state.seeded) return null;
    final catalog = VeneraCatalog(
      entries: await snapshot.entries(),
      origin: veneraSnapshotOrigin,
      downloadBase: veneraSnapshotSourceDir,
    );
    final report = await install(catalog);
    if (report.count(MarketInstallStatus.installed) > 0 ||
        report.count(MarketInstallStatus.upToDate) > 0) {
      await store.writeState(
        VeneraStoreState(seeded: true, catalogUrl: state.catalogUrl, showAdult: state.showAdult),
      );
    }
    return report;
  }

  Future<MarketInstallReport> installAllFromCatalog({bool onlyInstalled = false}) async {
    return install(await fetchCatalog(), onlyInstalled: onlyInstalled);
  }

  Future<MarketInstallReport> install(
    VeneraCatalog catalog, {
    Set<String>? ids,
    bool onlyInstalled = false,
    bool Function(String key)? enableByDefault,
    List<String>? basesOverride,
  }) async {
    final loaded = await store.loadAll();
    final installed = {for (final item in loaded.sources) item.meta.id: item.meta};
    final bases = basesOverride ?? await catalogBases();
    final targets = [
      for (final entry in catalog.entries)
        if ((ids == null || ids.contains(entry.id)) &&
            (!onlyInstalled || installed.containsKey(entry.id)))
          entry,
    ];
    final items = <MarketInstallItem>[];
    for (var start = 0; start < targets.length; start += parallelism) {
      final end = start + parallelism > targets.length ? targets.length : start + parallelism;
      items.addAll(await Future.wait([
        for (final entry in targets.sublist(start, end))
          _installOne(entry, installed[entry.id], catalog, bases, enableByDefault ?? veneraEnabledByDefault),
      ]));
    }
    return MarketInstallReport(
      items: items,
      catalogOrigin: catalog.origin,
      catalogWarnings: catalog.warnings,
    );
  }

  Future<MarketInstallItem> _installOne(
    VeneraCatalogEntry entry,
    InstalledVeneraSource? existing,
    VeneraCatalog catalog,
    List<String> bases,
    bool Function(String key) enableByDefault,
  ) async {
    MarketInstallItem result(MarketInstallStatus status, {String message = '', String? version}) =>
        MarketInstallItem(
          id: entry.id,
          name: entry.name,
          status: status,
          message: message,
          version: version ?? entry.version,
        );

    if (existing != null && compareSourceVersions(existing.version, entry.version) >= 0) {
      return result(MarketInstallStatus.upToDate, version: existing.version);
    }

    String? text;
    var origin = 'mirror';
    var note = '';
    var downloadedFrom = catalog.downloadBase;
    Object? downloadError;
    if (!catalog.isSnapshot) {
      try {
        final fetched = await fetcher.fetch(
          bases,
          entry.fileName,
          maxBytes: veneraMaxSourceBytes,
          json: false,
          validate: (body, _) => validateVeneraSource(body, expectedKey: entry.key),
        );
        text = fetched.text;
        downloadedFrom = fetched.base;
      } catch (error) {
        downloadError = error;
      }
    }
    if (text == null) {
      final snapshotText = await snapshot.sourceText(entry.fileName);
      if (snapshotText != null) {
        try {
          validateVeneraSource(snapshotText, expectedKey: entry.key);
          text = snapshotText;
          origin = veneraSnapshotOrigin;
          downloadedFrom = veneraSnapshotSourceDir;
          note = downloadError == null ? '' : '镜像失败，已用内置快照';
        } catch (error) {
          downloadError ??= error;
        }
      }
    }
    if (text == null) {
      return result(
        MarketInstallStatus.failed,
        message: '下载失败${existing == null ? '' : '，保留当前版本 ${existing.version}'}：${downloadError ?? '内置快照没有该来源'}',
      );
    }

    try {
      final now = _clock().toUtc();
      final meta = InstalledVeneraSource(
        id: entry.id,
        key: entry.key,
        name: entry.name,
        version: entry.version,
        fileName: entry.fileName,
        downloadUrl: '$downloadedFrom${entry.fileName}',
        catalogUrl: catalog.origin,
        enabled: existing?.enabled ?? enableByDefault(entry.key),
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
        origin: origin,
        hints: VeneraConfigHints.analyze(text),
        description: entry.description,
      );
      await store.save(meta, text);
      return result(
        existing == null ? MarketInstallStatus.installed : MarketInstallStatus.updated,
        message: note,
      );
    } catch (error) {
      return result(MarketInstallStatus.failed, message: '来源无效或保存失败：$error');
    }
  }

  Future<InstalledVeneraSource> setEnabled(String id, bool enabled) async {
    final loaded = await store.loadAll();
    final current = loaded.sources.where((r) => r.meta.id == id).firstOrNull;
    if (current == null) throw VeneraException('来源未安装：$id');
    final next = current.meta.copyWith(enabled: enabled, userDisabled: !enabled);
    await store.saveMeta(next);
    return next;
  }

  Future<int> enableRecommended() async {
    final loaded = await store.loadAll();
    var count = 0;
    for (final item in loaded.sources) {
      if (item.meta.enabled || item.meta.userDisabled) continue;
      if (isAdultVeneraKey(item.meta.key) || !veneraEnabledByDefault(item.meta.key)) continue;
      await store.saveMeta(item.meta.copyWith(enabled: true));
      count++;
    }
    return count;
  }

  Future<void> uninstall(String id) async {
    await store.remove(id);
    await secrets?.delete(veneraAccountSecretKey(id));
  }

  Future<bool> showAdult() async => (await store.readState()).showAdult;

  Future<void> setShowAdult(bool value) async {
    final state = await store.readState();
    await store.writeState(
      VeneraStoreState(seeded: state.seeded, catalogUrl: state.catalogUrl, showAdult: value),
    );
    if (value) return;
    final loaded = await store.loadAll();
    for (final item in loaded.sources) {
      if (item.meta.enabled && isAdultVeneraKey(item.meta.key)) {
        await store.saveMeta(item.meta.copyWith(enabled: false));
      }
    }
  }
}
