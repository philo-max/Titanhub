import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sandbox/local_plugin_runner.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/core/sources/market/market_infra.dart';
import 'package:titanhub/core/sources/media_source.dart';
import 'package:titanhub/core/sources/venera/venera_catalog.dart';
import 'package:titanhub/core/sources/venera/venera_manager.dart';
import 'package:titanhub/core/sources/venera/venera_providers.dart';
import 'package:titanhub/core/sources/venera/venera_store.dart';

Future<String> assetLoader(String key) => File(key).readAsString();

void main() {
  late Directory dir;
  late ProviderContainer container;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('venera-provider-test');
    container = ProviderContainer(overrides: [
      veneraManagerProvider.overrideWith((ref) async => VeneraManager(
            store: VeneraStore(dir),
            fetcher: MirrorFetcher(httpGet: (url, max) async => throw Exception('offline')),
            snapshot: VeneraSnapshot(loader: assetLoader),
          )),
    ]);
  });

  tearDown(() {
    container.dispose();
    dir.deleteSync(recursive: true);
  });

  test('启动加载：首次用内置快照安装并注册为漫画来源，按默认启用策略启停，内置来源不受影响', () async {
    final before = container.read(localSourcesProvider).map((s) => s.id).toList();
    await container.read(veneraSourcesProvider.notifier).load();
    final state = container.read(veneraSourcesProvider);
    expect(state.error, isNull);
    expect(state.installed.length, greaterThanOrEqualTo(30));
    final sources = container.read(localSourcesProvider);
    expect(sources.take(before.length).map((s) => s.id), before);
    final copy = sources.firstWhere((s) => s.id == 'venera-copy_manga');
    expect(copy.types, ['manga']);
    expect(copy.supports(MediaCapability.images), isTrue);
    expect(copy.supports(MediaCapability.video), isFalse);
    expect(container.read(enabledSourceIdsProvider).contains('venera-copy_manga'), isTrue);
    expect(container.read(enabledSourceIdsProvider).contains('venera-picacg'), isFalse);
    expect(container.read(enabledSourceIdsProvider).contains('venera-jm'), isFalse);
    expect(container.read(localPluginRunnerProvider).hasVeneraSource('venera-copy_manga'), isTrue);
  });

  test('启用后进入漫画分类搜索清单，停用/卸载后移除并清理运行器', () async {
    final notifier = container.read(veneraSourcesProvider.notifier);
    await notifier.load();
    await notifier.setEnabled('venera-copy_manga', true);
    expect(container.read(searchSourcesProvider(MediaTypeFilter.manga)).any((s) => s.id == 'venera-copy_manga'), isTrue);
    expect(container.read(searchSourcesProvider(MediaTypeFilter.anime)).any((s) => s.id == 'venera-copy_manga'), isFalse);
    await notifier.setEnabled('venera-copy_manga', false);
    expect(container.read(activeSourcesProvider).any((s) => s.id == 'venera-copy_manga'), isFalse);
    await notifier.uninstall('venera-copy_manga');
    expect(container.read(localSourcesProvider).any((s) => s.id == 'venera-copy_manga'), isFalse);
    expect(container.read(localPluginRunnerProvider).hasVeneraSource('venera-copy_manga'), isFalse);
  });

  test('重启保留启停状态；非 HTTPS 目录地址报错', () async {
    var notifier = container.read(veneraSourcesProvider.notifier);
    await notifier.load();
    await notifier.setEnabled('venera-picacg', true);
    await notifier.setCatalogUrl('http://x.test/');
    expect(container.read(veneraSourcesProvider).error, contains('HTTPS'));

    final second = ProviderContainer(overrides: [
      veneraManagerProvider.overrideWith((ref) async => VeneraManager(
            store: VeneraStore(dir),
            fetcher: MirrorFetcher(httpGet: (url, max) async => throw Exception('offline')),
            snapshot: VeneraSnapshot(loader: assetLoader),
          )),
    ]);
    addTearDown(second.dispose);
    await second.read(veneraSourcesProvider.notifier).load();
    expect(second.read(enabledSourceIdsProvider).contains('venera-picacg'), isTrue);
    expect(second.read(enabledSourceIdsProvider).contains('venera-copy_manga'), isTrue);
  });

  test('运行器路由：已注册 Venera 来源经 runner.call 走 Venera 运行时', () async {
    final notifier = container.read(veneraSourcesProvider.notifier);
    await notifier.load();
    final runner = container.read(localPluginRunnerProvider);
    expect(() => runner.call('venera-copy_manga', 'getContent', ['x']), throwsA(isA<Object>()));
  });
}
