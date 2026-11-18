import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sandbox/local_plugin_runner.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_catalog.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_manager.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_providers.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_store.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/core/sources/market/market_infra.dart';
import 'package:titanhub/core/sources/unified/source_kind.dart';
import 'package:titanhub/core/sources/unified/unified_models.dart';
import 'package:titanhub/core/sources/unified/unified_sources.dart';
import 'package:titanhub/core/sources/venera/venera_catalog.dart';
import 'package:titanhub/core/sources/venera/venera_manager.dart';
import 'package:titanhub/core/sources/venera/venera_providers.dart';
import 'package:titanhub/core/sources/venera/venera_store.dart';
import 'package:titanhub/features/media/providers/media_providers.dart';

Future<String> assetLoader(String key) => File(key).readAsString();

class _SearchRunner extends LocalPluginRunner {
  final Map<String, Object> results = {};

  @override
  Future<dynamic> call(String pluginId, String method, List<dynamic> args) async {
    final result = results[pluginId];
    if (result is Exception) throw result;
    return result ?? const [];
  }
}

void main() {
  late Directory kazumiDir;
  late Directory veneraDir;
  late ProviderContainer container;
  late _SearchRunner runner;
  var online = false;
  var copyMangaVersion = '1.4.3';

  Future<List<int>> net(String url, int max) async {
    if (!online) throw Exception('offline');
    final uri = Uri.parse(url);
    if (uri.host == 'sub.test' && url.endsWith('/rules/index.json')) {
      return utf8.encode(jsonEncode([
        {'name': 'AGE', 'version': '1.0'},
      ]));
    }
    if (uri.host == 'sub.test' && url.endsWith('/rules/AGE.json')) {
      return File('assets/kazumi/rules/AGE.json').readAsBytesSync();
    }
    if (uri.host == 'sub.test' && url.endsWith('/cfg/index.json')) {
      return utf8.encode(jsonEncode([
        {'name': '拷贝漫画', 'key': 'copy_manga', 'fileName': 'copy_manga.js', 'version': copyMangaVersion},
      ]));
    }
    if (uri.host == 'sub.test' && url.endsWith('/cfg/copy_manga.js')) {
      return File('assets/venera/sources/copy_manga.js').readAsBytesSync();
    }
    if (uri.host == 'sub.test' && url.endsWith('/unknown/index.json')) {
      return utf8.encode(jsonEncode({'hello': 'world'}));
    }
    if (uri.host == 'sub.test' && url.endsWith('/notjson/index.json')) {
      return utf8.encode('<html>');
    }
    if (uri.host == 'sub.test' && url.endsWith('/empty/index.json')) {
      return utf8.encode('[]');
    }
    if (uri.host == 'sub.test' && url.endsWith('/anime-only/index.json')) {
      return utf8.encode(jsonEncode([
        {'name': 'AGE', 'version': '1.0'},
      ]));
    }
    if (url.endsWith('/cfg/index.json') || url.endsWith('index.json')) {
      return utf8.encode(jsonEncode([
        {'name': '拷贝漫画', 'key': 'copy_manga', 'fileName': 'copy_manga.js', 'version': copyMangaVersion},
      ]));
    }
    throw Exception('404 $url');
  }

  UnifiedSourceController controllerOf() => container.read(unifiedSourceControllerProvider);

  setUp(() {
    online = false;
    copyMangaVersion = '1.4.3';
    kazumiDir = Directory.systemTemp.createTempSync('unified-kazumi');
    veneraDir = Directory.systemTemp.createTempSync('unified-venera');
    runner = _SearchRunner();
    container = ProviderContainer(overrides: [
      localPluginRunnerProvider.overrideWithValue(runner),
      subscriptionFetcherProvider.overrideWithValue(MirrorFetcher(httpGet: net)),
      kazumiManagerProvider.overrideWith((ref) async => KazumiRuleManager(
            store: KazumiRuleStore(kazumiDir),
            fetcher: KazumiMirrorFetcher(httpGet: net),
            snapshot: KazumiSnapshot(loader: assetLoader),
            reservedIds: {for (final s in bundledSources) s.id},
          )),
      veneraManagerProvider.overrideWith((ref) async => VeneraManager(
            store: VeneraStore(veneraDir),
            fetcher: MirrorFetcher(httpGet: net),
            snapshot: VeneraSnapshot(loader: assetLoader),
          )),
    ]);
  });

  tearDown(() {
    container.dispose();
    kazumiDir.deleteSync(recursive: true);
    veneraDir.deleteSync(recursive: true);
  });

  Future<void> loadBoth() async {
    await container.read(kazumiSourcesProvider.notifier).load();
    await container.read(veneraSourcesProvider.notifier).load();
  }

  group('聚合 provider', () {
    test('四类入口：仅动漫、漫画可用，小说影视为空占位', () {
      expect(SourceKind.values.where((k) => k.available), [SourceKind.anime, SourceKind.manga]);
      expect(SourceKind.novel.title, '小说源配置');
      expect(SourceKind.movie.title, '影视源配置');
      for (final kind in [SourceKind.novel, SourceKind.movie]) {
        final view = container.read(unifiedKindViewProvider(kind));
        expect(view.sources, isEmpty);
        expect(view.available, isEmpty);
      }
      expect(SourceKind.fromSlug('manga'), SourceKind.manga);
      expect(SourceKind.fromSlug('x'), isNull);
    });

    test('动漫与漫画分别聚合各自引擎的来源，且元数据不暴露引擎名', () async {
      await loadBoth();
      final anime = container.read(unifiedKindViewProvider(SourceKind.anime));
      final manga = container.read(unifiedKindViewProvider(SourceKind.manga));
      expect(anime.sources.length, 17);
      expect(anime.sources.every((s) => s.kind == SourceKind.anime && s.enabled), isTrue);
      expect(manga.sources.length, 33);
      expect(manga.sources.every((s) => s.kind == SourceKind.manga), isTrue);
      final labels = [
        for (final s in [...anime.sources, ...manga.sources]) ...[s.name, ...s.tags.map((t) => t.label)],
      ].join('|').toLowerCase();
      expect(labels, isNot(contains('kazumi')));
      expect(labels, isNot(contains('venera')));
    });

    test('漫画标签：成人向、需登录、需配置、实验兼容', () async {
      await loadBoth();
      final manga = container.read(unifiedKindViewProvider(SourceKind.manga));
      UnifiedSource byId(String id) => manga.sources.firstWhere((s) => s.id == id);
      expect(byId('venera-jm').tags, contains(SourceTag.adult));
      expect(byId('venera-jm').enabled, isFalse);
      expect(byId('venera-picacg').tags, contains(SourceTag.needsLogin));
      expect(byId('venera-picacg').enabled, isFalse);
      expect(byId('venera-komga').tags, contains(SourceTag.needsConfig));
      expect(byId('venera-copy_manga').tags, [SourceTag.experimental]);
      expect(byId('venera-copy_manga').enabled, isTrue);
      expect(manga.adult.map((s) => s.id).toSet().length, 8);
      expect(manga.regular.length, 25);
      expect(manga.enabledCount, 20);
      expect(manga.supportsAdult, isTrue);
      expect(manga.showAdult, isFalse);
    });

    test('启停与卸载按来源 id 分发到对应引擎', () async {
      await loadBoth();
      final controller = controllerOf();
      await controller.setEnabled('kazumi-age', false);
      await controller.setEnabled('venera-copy_manga', false);
      expect(container.read(enabledSourceIdsProvider).contains('kazumi-age'), isFalse);
      expect(container.read(enabledSourceIdsProvider).contains('venera-copy_manga'), isFalse);
      await controller.uninstall('kazumi-age');
      await controller.uninstall('venera-copy_manga');
      expect(container.read(unifiedKindViewProvider(SourceKind.anime)).sources.any((s) => s.id == 'kazumi-age'), isFalse);
      expect(container.read(unifiedKindViewProvider(SourceKind.manga)).sources.any((s) => s.id == 'venera-copy_manga'), isFalse);
      expect(container.read(unifiedEnabledCountProvider), 16 + 19);
    });

    test('一键安装推荐来源：漫画不含成人向，结果报告可见', () async {
      await controllerOf().installRecommended(SourceKind.manga);
      final view = container.read(unifiedKindViewProvider(SourceKind.manga));
      expect(view.error, isNull);
      expect(view.sources.length, 25);
      expect(view.adult, isEmpty);
      expect(view.report!.installed, 25);
      expect(view.report!.failures, isEmpty);
      expect(view.report!.origins, ['snapshot']);
      expect(view.report!.warnings.join(), contains('内置快照'));
    });

    test('一键安装推荐来源：动漫全量安装并汇总', () async {
      await controllerOf().installRecommended(SourceKind.anime);
      final view = container.read(unifiedKindViewProvider(SourceKind.anime));
      expect(view.sources.length, 17);
      expect(view.report!.installed, 17);
      expect(view.report!.skipped, 1);
      expect(view.report!.summary, contains('新装 17'));
    });

    test('检查更新：目录版本更高的来源带可更新标签，全部更新后消失', () async {
      await loadBoth();
      online = true;
      copyMangaVersion = '9.9.9';
      await controllerOf().checkUpdates(SourceKind.manga);
      var view = container.read(unifiedKindViewProvider(SourceKind.manga));
      expect(view.catalogLoaded, isTrue);
      expect(view.updatableCount, 1);
      expect(view.sources.firstWhere((s) => s.id == 'venera-copy_manga').tags, contains(SourceTag.updatable));
      expect(view.available.any((a) => a.id == 'venera-copy_manga'), isFalse);
    });

    test('可安装列表：目录中尚未安装的来源，成人向带标记', () async {
      await loadBoth();
      await controllerOf().uninstall('venera-jm');
      await controllerOf().uninstall('venera-baozi');
      await controllerOf().checkUpdates(SourceKind.manga);
      final view = container.read(unifiedKindViewProvider(SourceKind.manga));
      final available = {for (final a in view.available) a.id: a};
      expect(available.keys, containsAll(['venera-jm', 'venera-baozi']));
      expect(available['venera-jm']!.adult, isTrue);
      expect(available['venera-baozi']!.adult, isFalse);
      await controllerOf().install('venera-baozi');
      expect(container.read(unifiedKindViewProvider(SourceKind.manga)).sources.any((s) => s.id == 'venera-baozi'), isTrue);
    });
  });

  group('一键安装启用推荐集合', () {
    Future<void> disableAllLegacy() async {
      final venera = await container.read(veneraManagerProvider.future);
      for (final item in (await venera.loadInstalled()).sources) {
        await venera.store.saveMeta(item.meta.copyWith(enabled: false));
      }
      final kazumi = await container.read(kazumiManagerProvider.future);
      for (final item in (await kazumi.loadInstalled()).rules) {
        await kazumi.store.saveMeta(item.meta.copyWith(enabled: false));
      }
      await container.read(veneraSourcesProvider.notifier).load();
      await container.read(kazumiSourcesProvider.notifier).load();
    }

    test('旧策略遗留的全部停用：漫画一键后启用推荐的 20 个，成人向与需登录/配置仍停用', () async {
      await loadBoth();
      await disableAllLegacy();
      expect(container.read(unifiedKindViewProvider(SourceKind.manga)).enabledCount, 0);
      await controllerOf().installRecommended(SourceKind.manga);
      final view = container.read(unifiedKindViewProvider(SourceKind.manga));
      expect(view.enabledCount, 20);
      expect(view.report!.enabled, 20);
      expect(view.report!.summary, contains('启用 20'));
      for (final id in ['venera-jm', 'venera-hitomi', 'venera-picacg', 'venera-komga']) {
        expect(view.sources.firstWhere((s) => s.id == id).enabled, isFalse, reason: id);
      }
      expect(container.read(enabledSourceIdsProvider).contains('venera-copy_manga'), isTrue);
      expect(container.read(searchSourcesProvider(MediaTypeFilter.manga)).any((s) => s.id == 'venera-copy_manga'), isTrue);
    });

    test('旧策略遗留的全部停用：动漫一键后全部启用', () async {
      await loadBoth();
      await disableAllLegacy();
      await controllerOf().installRecommended(SourceKind.anime);
      final view = container.read(unifiedKindViewProvider(SourceKind.anime));
      expect(view.enabledCount, 17);
      expect(view.report!.enabled, 17);
      expect(container.read(unifiedEnabledCountProvider), 17);
    });

    test('用户手动停用的来源不会被一键启用，重新手动启用后清除标记', () async {
      await loadBoth();
      await controllerOf().setEnabled('venera-copy_manga', false);
      await controllerOf().setEnabled('kazumi-age', false);
      await controllerOf().installRecommended(SourceKind.manga);
      await controllerOf().installRecommended(SourceKind.anime);
      expect(container.read(enabledSourceIdsProvider).contains('venera-copy_manga'), isFalse);
      expect(container.read(enabledSourceIdsProvider).contains('kazumi-age'), isFalse);
      expect(container.read(unifiedKindViewProvider(SourceKind.manga)).report!.enabled, 0);
      await controllerOf().setEnabled('venera-copy_manga', true);
      final manager = await container.read(veneraManagerProvider.future);
      final meta = (await manager.loadInstalled()).sources.firstWhere((s) => s.meta.id == 'venera-copy_manga').meta;
      expect(meta.userDisabled, isFalse);
    });

    test('旧元数据没有 userDisabled 字段按非用户停用处理', () async {
      await loadBoth();
      final manager = await container.read(veneraManagerProvider.future);
      final loaded = (await manager.loadInstalled()).sources.first.meta;
      final json = loaded.toJson()..remove('userDisabled')..['enabled'] = false;
      await File('${veneraDir.path}/sources/${loaded.id}.meta.json').writeAsString(jsonEncode(json));
      final again = (await manager.loadInstalled()).sources.firstWhere((s) => s.meta.id == loaded.id).meta;
      expect(again.userDisabled, isFalse);
      expect(again.enabled, isFalse);
    });
  });

  group('显示成人向来源', () {
    test('打开后可见并可逐个启用，关闭后全部停用', () async {
      await loadBoth();
      final controller = controllerOf();
      await controller.setShowAdult(true);
      expect(container.read(unifiedKindViewProvider(SourceKind.manga)).showAdult, isTrue);
      await controller.setEnabled('venera-hitomi', true);
      expect(container.read(enabledSourceIdsProvider).contains('venera-hitomi'), isTrue);
      expect(container.read(enabledSourceIdsProvider).contains('venera-jm'), isFalse);
      await controller.setShowAdult(false);
      expect(container.read(enabledSourceIdsProvider).contains('venera-hitomi'), isFalse);
      expect(container.read(unifiedKindViewProvider(SourceKind.manga)).enabledCount, 20);
    });
  });

  group('导入订阅地址', () {
    test('非 HTTPS 地址被拒绝', () async {
      final error = await controllerOf().importSubscription(SourceKind.anime, 'http://sub.test/rules/');
      expect(error, contains('HTTPS'));
    });

    test('读取失败给出原因', () async {
      final error = await controllerOf().importSubscription(SourceKind.anime, 'https://sub.test/rules/');
      expect(error, contains('无法读取订阅目录'));
    });

    test('格式无法识别时明确报错，不安装任何东西', () async {
      online = true;
      for (final path in ['unknown', 'notjson', 'empty']) {
        final error = await controllerOf().importSubscription(SourceKind.manga, 'https://sub.test/$path/');
        expect(error, isNotNull, reason: path);
        if (path == 'notjson') {
          expect(error, contains('无法读取订阅目录'));
        } else {
          expect(error, contains('无法识别订阅格式'));
        }
        expect(error!.toLowerCase(), isNot(contains('kazumi')));
        expect(error.toLowerCase(), isNot(contains('venera')));
      }
      expect(container.read(unifiedKindViewProvider(SourceKind.manga)).sources, isEmpty);
    });

    test('目录类型与当前页面不符时提示去对应配置页', () async {
      online = true;
      final error = await controllerOf().importSubscription(SourceKind.manga, 'https://sub.test/anime-only/');
      expect(error, contains('动漫源配置'));
      expect(container.read(unifiedKindViewProvider(SourceKind.anime)).sources, isEmpty);
    });

    test('规则目录：识别并安装其中来源，不改保存的目录地址', () async {
      online = true;
      final error = await controllerOf().importSubscription(SourceKind.anime, 'https://sub.test/rules/');
      expect(error, isNull);
      final view = container.read(unifiedKindViewProvider(SourceKind.anime));
      expect(view.sources.map((s) => s.id), ['kazumi-age']);
      expect(view.report!.installed, 1);
      expect(view.report!.origins, ['https://sub.test/rules/']);
      expect(view.catalogUrl, isEmpty);
      expect(view.sources.single.enabled, isTrue);
    });

    test('脚本目录：识别并安装，第三方脚本默认停用', () async {
      online = true;
      final error = await controllerOf().importSubscription(SourceKind.manga, 'https://sub.test/cfg/index.json');
      expect(error, isNull);
      final view = container.read(unifiedKindViewProvider(SourceKind.manga));
      expect(view.sources.map((s) => s.id), ['venera-copy_manga']);
      expect(view.sources.single.enabled, isFalse);
      expect(view.catalogUrl, isEmpty);
      expect(container.read(enabledSourceIdsProvider).contains('venera-copy_manga'), isFalse);
    });
  });

  group('漫画并行搜索', () {
    test('已启用的漫画来源与内置 MangaDex 并行搜索，单个失败不拖垮整体且原因可见', () async {
      await loadBoth();
      runner.results['mangadex'] = [
        {'id': 'm1', 'title': 'MangaDex 结果', 'cover': ''},
      ];
      runner.results['venera-copy_manga'] = [
        {'id': 'c1', 'title': '拷贝结果', 'cover': ''},
      ];
      runner.results['venera-mxs'] = Exception('站点 403');
      final sources = container.read(searchSourcesProvider(MediaTypeFilter.manga));
      expect(sources.any((s) => s.id == 'mangadex'), isTrue);
      expect(sources.any((s) => s.id == 'venera-copy_manga'), isTrue);
      expect(sources.any((s) => s.id == 'venera-jm'), isFalse);
      final outcome = await container.read(
        searchMediaProvider((query: '海贼王', type: MediaTypeFilter.manga)).future,
      );
      expect(outcome.items.map((i) => i.title), containsAll(['MangaDex 结果', '拷贝结果']));
      expect(outcome.failures.length, 1);
      expect(outcome.failures.values.single, contains('站点 403'));
      expect(outcome.searchedSources, sources.length);
    });
  });
}
