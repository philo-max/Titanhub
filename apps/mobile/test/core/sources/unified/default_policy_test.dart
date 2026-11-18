import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/market/market_infra.dart';
import 'package:titanhub/core/sources/venera/venera_catalog.dart';
import 'package:titanhub/core/sources/venera/venera_manager.dart';
import 'package:titanhub/core/sources/venera/venera_policy.dart';
import 'package:titanhub/core/sources/venera/venera_store.dart';
import 'package:titanhub/core/sync/webdav_config_store.dart';

class _Secrets implements SecureKeyValue {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

Future<String> assetLoader(String key) => File(key).readAsString();

void main() {
  late Directory dir;
  late _Secrets secrets;
  late VeneraManager manager;

  setUp(() {
    dir = Directory.systemTemp.createTempSync('policy-test');
    secrets = _Secrets();
    manager = VeneraManager(
      store: VeneraStore(dir),
      fetcher: MirrorFetcher(httpGet: (url, max) async => throw Exception('offline')),
      snapshot: VeneraSnapshot(loader: assetLoader),
      secrets: secrets,
    );
  });

  tearDown(() => dir.deleteSync(recursive: true));

  test('成人向识别：常量名单，大小写不敏感', () {
    expect(veneraAdultKeys, {'hitomi', 'nhentai', 'wnacg', 'ehentai', 'jm', 'hcomic', 'jcomic', 'mh18'});
    expect(isAdultVeneraKey('Hitomi'), isTrue);
    expect(isAdultVeneraKey('copy_manga'), isFalse);
  });

  test('默认启用策略：成人向、需登录、需配置默认停用，其余启用', () {
    for (final key in veneraAdultKeys) {
      expect(veneraEnabledByDefault(key), isFalse, reason: key);
    }
    for (final key in veneraLoginRequiredKeys) {
      expect(veneraEnabledByDefault(key), isFalse, reason: key);
    }
    for (final key in veneraConfigRequiredKeys) {
      expect(veneraEnabledByDefault(key), isFalse, reason: key);
    }
    expect(veneraEnabledByDefault('copy_manga'), isTrue);
    expect(veneraEnabledByDefault('manga_dex'), isTrue);
  });

  test('首次从快照安装：启用集合符合策略，成人向与需登录配置全部停用', () async {
    await manager.seedFromSnapshotIfFirstRun();
    final loaded = (await manager.loadInstalled()).sources;
    final enabled = loaded.where((s) => s.meta.enabled).map((s) => s.meta.key).toSet();
    final disabled = loaded.where((s) => !s.meta.enabled).map((s) => s.meta.key).toSet();
    expect(enabled.length, 20);
    expect(enabled.intersection(veneraAdultKeys), isEmpty);
    expect(enabled.intersection(veneraLoginRequiredKeys), isEmpty);
    expect(enabled.intersection(veneraConfigRequiredKeys), isEmpty);
    expect(disabled, {...veneraAdultKeys, ...veneraLoginRequiredKeys, ...veneraConfigRequiredKeys});
  });

  test('成人向与需登录默认来源在内置快照里都存在', () async {
    final keys = {for (final e in await VeneraSnapshot(loader: assetLoader).entries()) e.key};
    expect(keys.containsAll(veneraAdultKeys), isTrue);
    expect(keys.containsAll(veneraLoginRequiredKeys), isTrue);
    expect(keys.containsAll(veneraConfigRequiredKeys), isTrue);
  });

  test('重新安装不覆盖用户已改的启停状态', () async {
    await manager.seedFromSnapshotIfFirstRun();
    await manager.setEnabled('venera-jm', true);
    await manager.setEnabled('venera-copy_manga', false);
    await manager.installAllFromCatalog();
    final loaded = {for (final s in (await manager.loadInstalled()).sources) s.meta.key: s.meta.enabled};
    expect(loaded['jm'], isTrue);
    expect(loaded['copy_manga'], isFalse);
  });

  test('显示成人向开关：默认关闭、持久化；关闭时停用所有成人向来源', () async {
    await manager.seedFromSnapshotIfFirstRun();
    expect(await manager.showAdult(), isFalse);
    await manager.setShowAdult(true);
    expect(await manager.showAdult(), isTrue);
    await manager.setCatalogUrl('https://cdn.test/venera/');
    expect(await manager.showAdult(), isTrue);
    await manager.setEnabled('venera-hitomi', true);
    await manager.setEnabled('venera-jm', true);
    await manager.setShowAdult(false);
    expect(await manager.showAdult(), isFalse);
    final loaded = (await manager.loadInstalled()).sources;
    expect(loaded.where((s) => isAdultVeneraKey(s.meta.key)).every((s) => !s.meta.enabled), isTrue);
    expect(loaded.firstWhere((s) => s.meta.key == 'copy_manga').meta.enabled, isTrue);
  });

  test('卸载同时清除该来源的安全存储口令，其他来源不受影响', () async {
    await manager.seedFromSnapshotIfFirstRun();
    secrets.values[veneraAccountSecretKey('venera-picacg')] = '["u","p"]';
    secrets.values[veneraAccountSecretKey('venera-copy_manga')] = '["x","y"]';
    await manager.uninstall('venera-picacg');
    expect(secrets.values.containsKey(veneraAccountSecretKey('venera-picacg')), isFalse);
    expect(secrets.values.containsKey(veneraAccountSecretKey('venera-copy_manga')), isTrue);
  });
}
