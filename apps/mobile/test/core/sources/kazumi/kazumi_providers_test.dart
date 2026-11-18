import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sandbox/local_plugin_runner.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_catalog.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_manager.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_models.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_providers.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_store.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/core/sources/media_source.dart';
import 'package:titanhub/core/sources/seven_se_fun_source.dart';

import 'kazumi_test_support.dart';

void main() {
  late Directory dir;
  late ProviderContainer container;

  KazumiRuleManager newManager() => KazumiRuleManager(
        store: KazumiRuleStore(dir),
        fetcher: KazumiMirrorFetcher(httpGet: (url, max) async => throw Exception('offline')),
        snapshot: KazumiSnapshot(loader: assetLoader),
        reservedIds: {for (final s in bundledSources) s.id},
      );

  setUp(() {
    dir = Directory.systemTemp.createTempSync('kazumi-provider-test');
    container = ProviderContainer(overrides: [
      kazumiManagerProvider.overrideWith((ref) async => newManager()),
    ]);
  });

  tearDown(() {
    container.dispose();
    dir.deleteSync(recursive: true);
  });

  test('启动加载：首次用内置快照安装，注册进来源清单、启用集合与运行器，内置来源不受影响', () async {
    final before = container.read(localSourcesProvider).map((s) => s.id).toList();
    expect(before, bundledSources.map((s) => s.id).toList());

    await container.read(kazumiSourcesProvider.notifier).load();

    final state = container.read(kazumiSourcesProvider);
    expect(state.loaded, isTrue);
    expect(state.error, isNull);
    expect(state.installed.length, 17);
    final sources = container.read(localSourcesProvider);
    expect(sources.take(bundledSources.length).map((s) => s.id), before);
    expect(sources.length, bundledSources.length + 17);
    expect(sources.where((s) => s.id == SevenSeFunSource.pluginId).length, 1);
    final age = sources.firstWhere((s) => s.id == 'kazumi-age');
    expect(age.name, 'AGE');
    expect(age.supports(MediaCapability.video), isTrue);
    expect(container.read(enabledSourceIdsProvider).contains('kazumi-age'), isTrue);
    expect(container.read(activeSourcesProvider).any((s) => s.id == 'kazumi-age'), isTrue);

    final runner = container.read(localPluginRunnerProvider);
    expect(runner.hasKazumiRule('kazumi-age'), isTrue);
    final video = await runner.call(
      'kazumi-age',
      'getVideoUrl',
      [Uri.encodeComponent('/play/1/1/1')],
    ) as List;
    expect((video.single as Map)['type'], 'page');
    expect((video.single as Map)['url'], 'https://www.agedm.io/play/1/1/1');
  });

  test('启停影响搜索启用集合，卸载移除来源与运行器注册，重启后状态保留', () async {
    final notifier = container.read(kazumiSourcesProvider.notifier);
    await notifier.load();
    await notifier.setEnabled('kazumi-age', false);
    expect(container.read(enabledSourceIdsProvider).contains('kazumi-age'), isFalse);
    expect(container.read(localSourcesProvider).any((s) => s.id == 'kazumi-age'), isTrue);

    await notifier.uninstall('kazumi-aafun');
    expect(container.read(localSourcesProvider).any((s) => s.id == 'kazumi-aafun'), isFalse);
    expect(container.read(localPluginRunnerProvider).hasKazumiRule('kazumi-aafun'), isFalse);

    final second = ProviderContainer(overrides: [
      kazumiManagerProvider.overrideWith((ref) async => newManager()),
    ]);
    addTearDown(second.dispose);
    await second.read(kazumiSourcesProvider.notifier).load();
    final ids = second.read(kazumiSourcesProvider).installed;
    expect(ids.length, 16);
    expect(ids.firstWhere((i) => i.id == 'kazumi-age').enabled, isFalse);
    expect(second.read(enabledSourceIdsProvider).contains('kazumi-age'), isFalse);
    expect(second.read(enabledSourceIdsProvider).contains('kazumi-ezdmw'), isTrue);
  });

  test('非 HTTPS 目录地址在状态里给出错误且不修改配置', () async {
    final notifier = container.read(kazumiSourcesProvider.notifier);
    await notifier.load();
    await notifier.setCatalogUrl('http://insecure.example.com/');
    expect(container.read(kazumiSourcesProvider).error, contains('HTTPS'));
    expect(container.read(kazumiSourcesProvider).catalogUrl, '');
    await notifier.setCatalogUrl('https://ok.example.com/rules');
    expect(container.read(kazumiSourcesProvider).catalogUrl, 'https://ok.example.com/rules/');
  });

  test('离线一键安装：目录与规则全部走内置快照并汇总结果', () async {
    final notifier = container.read(kazumiSourcesProvider.notifier);
    await notifier.load();
    await notifier.uninstall('kazumi-age');
    await notifier.installAll();
    final report = container.read(kazumiSourcesProvider).lastReport!;
    expect(report.catalogOrigin, kazumiSnapshotOrigin);
    expect(report.count(KazumiInstallStatus.installed), 1);
    expect(container.read(kazumiSourcesProvider).installed.length, 17);
  });
}
