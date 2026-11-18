import 'dart:convert';

import 'kazumi_catalog.dart';
import 'kazumi_models.dart';
import 'kazumi_rule.dart';
import 'kazumi_store.dart';

class KazumiCatalog {
  const KazumiCatalog({
    required this.entries,
    required this.origin,
    required this.downloadBase,
    this.warnings = const [],
  });

  final List<KazumiCatalogEntry> entries;
  final String origin;
  final String downloadBase;
  final List<String> warnings;

  bool get isSnapshot => origin == kazumiSnapshotOrigin;
}

const String kazumiSnapshotOrigin = 'snapshot';

class KazumiRuleManager {
  KazumiRuleManager({
    required this.store,
    KazumiMirrorFetcher? fetcher,
    KazumiSnapshot? snapshot,
    DateTime Function()? clock,
    this.reservedIds = const {},
    this.parallelism = 4,
  })  : fetcher = fetcher ?? KazumiMirrorFetcher(),
        snapshot = snapshot ?? KazumiSnapshot(),
        _clock = clock ?? DateTime.now;

  final KazumiRuleStore store;
  final KazumiMirrorFetcher fetcher;
  final KazumiSnapshot snapshot;
  final Set<String> reservedIds;
  final int parallelism;
  final DateTime Function() _clock;

  Future<List<String>> catalogBases() async {
    final custom = (await store.readState()).catalogUrl;
    final normalized = custom.isEmpty ? null : normalizeKazumiCatalogBase(custom);
    return normalized == null ? defaultKazumiCatalogBases : [normalized];
  }

  Future<void> setCatalogUrl(String input) async {
    final trimmed = input.trim();
    final state = await store.readState();
    if (trimmed.isEmpty) {
      await store.writeState(KazumiStoreState(seeded: state.seeded));
      return;
    }
    final normalized = normalizeKazumiCatalogBase(trimmed);
    if (normalized == null) {
      throw const KazumiRuleException('目录地址必须是 HTTPS，且不能包含账号、查询串或片段');
    }
    await store.writeState(KazumiStoreState(seeded: state.seeded, catalogUrl: normalized));
  }

  Future<KazumiStoreLoadResult> loadInstalled() => store.loadAll();

  Future<KazumiCatalog> fetchCatalog() async {
    final bases = await catalogBases();
    final warnings = <String>[];
    try {
      final fetched = await fetcher.fetchJson(
        bases,
        'index.json',
        maxBytes: kazumiMaxIndexBytes,
        validate: (json) {
          if (json is! List) throw const KazumiRuleException('目录不是数组');
        },
      );
      final entries = <KazumiCatalogEntry>[];
      final seen = <String>{};
      for (final item in fetched.json as List) {
        try {
          final entry = KazumiCatalogEntry.fromIndexEntry(item, fetched.base);
          if (seen.add(entry.id)) entries.add(entry);
        } on KazumiRuleException catch (error) {
          warnings.add('忽略无效目录条目：$error');
        }
      }
      if (entries.isEmpty) {
        throw const KazumiRuleException('目录没有任何有效条目');
      }
      return KazumiCatalog(
        entries: entries,
        origin: fetched.base,
        downloadBase: fetched.base,
        warnings: warnings,
      );
    } catch (error) {
      warnings.add('在线目录不可用，已改用内置快照：$error');
      final entries = await snapshot.entries();
      return KazumiCatalog(
        entries: entries,
        origin: kazumiSnapshotOrigin,
        downloadBase: kazumiSnapshotRuleDir,
        warnings: warnings,
      );
    }
  }

  Future<KazumiInstallReport?> seedFromSnapshotIfFirstRun() async {
    final state = await store.readState();
    if (state.seeded) return null;
    final entries = await snapshot.entries();
    final catalog = KazumiCatalog(
      entries: entries,
      origin: kazumiSnapshotOrigin,
      downloadBase: kazumiSnapshotRuleDir,
    );
    final report = await install(catalog);
    if (report.count(KazumiInstallStatus.installed) > 0 ||
        report.count(KazumiInstallStatus.upToDate) > 0) {
      await store.writeState(KazumiStoreState(seeded: true, catalogUrl: state.catalogUrl));
    }
    return report;
  }

  Future<KazumiInstallReport> installAllFromCatalog({bool onlyInstalled = false}) async {
    final catalog = await fetchCatalog();
    return install(catalog, onlyInstalled: onlyInstalled);
  }

  Future<KazumiInstallReport> install(
    KazumiCatalog catalog, {
    Set<String>? ids,
    bool onlyInstalled = false,
    List<String>? basesOverride,
  }) async {
    final loaded = await store.loadAll();
    final installed = {for (final item in loaded.rules) item.meta.id: item.meta};
    final bases = basesOverride ?? await catalogBases();
    final targets = [
      for (final entry in catalog.entries)
        if ((ids == null || ids.contains(entry.id)) &&
            (!onlyInstalled || installed.containsKey(entry.id)))
          entry,
    ];
    final items = <KazumiInstallItem>[];
    for (var start = 0; start < targets.length; start += parallelism) {
      final end = start + parallelism > targets.length ? targets.length : start + parallelism;
      items.addAll(await Future.wait([
        for (final entry in targets.sublist(start, end))
          _installOne(entry, installed[entry.id], catalog, bases),
      ]));
    }
    return KazumiInstallReport(
      items: items,
      catalogOrigin: catalog.origin,
      catalogWarnings: catalog.warnings,
    );
  }

  Future<KazumiInstallItem> _installOne(
    KazumiCatalogEntry entry,
    InstalledKazumiSource? existing,
    KazumiCatalog catalog,
    List<String> bases,
  ) async {
    KazumiInstallItem result(KazumiInstallStatus status, {String message = '', String? version}) =>
        KazumiInstallItem(
          id: entry.id,
          name: entry.name,
          status: status,
          message: message,
          version: version ?? entry.version,
        );

    if (reservedIds.contains(entry.id)) {
      return result(KazumiInstallStatus.skipped, message: '与内置来源同一身份，保留内置实现');
    }
    if (existing != null && compareKazumiVersions(existing.version, entry.version) >= 0) {
      return result(KazumiInstallStatus.upToDate, version: existing.version);
    }

    String? text;
    var origin = 'mirror';
    var note = '';
    var downloadedFrom = catalog.downloadBase;
    Object? downloadError;
    if (!catalog.isSnapshot) {
      try {
        final fetched = await fetcher.fetchJson(
          bases,
          '${Uri.encodeComponent(entry.name)}.json',
          maxBytes: kazumiMaxRuleBytes,
          validate: (json) => _validateRule(json, entry),
        );
        text = fetched.text;
        downloadedFrom = fetched.base;
      } catch (error) {
        downloadError = error;
      }
    }
    if (text == null) {
      final snapshotText = await snapshot.ruleText(entry.name);
      if (snapshotText != null) {
        try {
          final rule = KazumiRule.fromJson(jsonDecode(snapshotText));
          if (rule.pluginId != entry.id) {
            throw const KazumiRuleException('内置快照规则身份不匹配');
          }
          if (existing != null && compareKazumiVersions(existing.version, rule.version) >= 0) {
            throw KazumiRuleException('内置快照版本 ${rule.version} 不高于已装版本 ${existing.version}');
          }
          text = snapshotText;
          origin = kazumiSnapshotOrigin;
          downloadedFrom = kazumiSnapshotRuleDir;
          note = downloadError == null ? '' : '镜像失败，已用内置快照（版本 ${rule.version}）';
        } catch (error) {
          downloadError ??= error;
        }
      }
    }
    if (text == null) {
      return result(
        KazumiInstallStatus.failed,
        message: '下载失败${existing == null ? '' : '，保留当前版本 ${existing.version}'}：${downloadError ?? '内置快照没有该规则'}',
      );
    }

    try {
      final rule = KazumiRule.fromJson(jsonDecode(text));
      final now = _clock().toUtc();
      final meta = InstalledKazumiSource(
        id: entry.id,
        name: rule.name,
        version: rule.version,
        type: rule.type,
        downloadUrl: origin == kazumiSnapshotOrigin
            ? '$kazumiSnapshotRuleDir${entry.name}.json'
            : '$downloadedFrom${Uri.encodeComponent(entry.name)}.json',
        catalogUrl: catalog.origin,
        enabled: existing?.enabled ?? true,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
        origin: origin,
      );
      await store.save(meta, text);
      final stale = compareKazumiVersions(rule.version, entry.version) < 0
          ? '镜像内容较旧（规则 ${rule.version} < 目录 ${entry.version}），后续更新会再尝试'
          : '';
      return result(
        existing == null ? KazumiInstallStatus.installed : KazumiInstallStatus.updated,
        message: [note, stale].where((s) => s.isNotEmpty).join('；'),
        version: rule.version,
      );
    } catch (error) {
      return result(KazumiInstallStatus.failed, message: '规则无效或保存失败：$error');
    }
  }

  void _validateRule(Object? json, KazumiCatalogEntry entry) {
    final rule = KazumiRule.fromJson(json);
    if (rule.pluginId != entry.id) {
      throw KazumiRuleException('规则身份 ${rule.pluginId} 与目录 ${entry.id} 不一致');
    }
  }

  Future<InstalledKazumiSource> setEnabled(String id, bool enabled) async {
    final loaded = await store.loadAll();
    final current = loaded.rules.where((r) => r.meta.id == id).firstOrNull;
    if (current == null) throw KazumiRuleException('来源未安装：$id');
    final next = current.meta.copyWith(enabled: enabled, userDisabled: !enabled);
    await store.saveMeta(next);
    return next;
  }

  Future<int> enableRecommended() async {
    final loaded = await store.loadAll();
    var count = 0;
    for (final item in loaded.rules) {
      if (item.meta.enabled || item.meta.userDisabled) continue;
      await store.saveMeta(item.meta.copyWith(enabled: true));
      count++;
    }
    return count;
  }

  Future<void> uninstall(String id) => store.remove(id);
}
