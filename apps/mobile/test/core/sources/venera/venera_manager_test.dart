import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/market/market_infra.dart';
import 'package:titanhub/core/sources/venera/venera_catalog.dart';
import 'package:titanhub/core/sources/venera/venera_manager.dart';
import 'package:titanhub/core/sources/venera/venera_policy.dart';
import 'package:titanhub/core/sources/venera/venera_models.dart';
import 'package:titanhub/core/sources/venera/venera_store.dart';

String sourceText(String key, String version) =>
    'class ${key}Src extends ComicSource {\n  name = "$key"\n  key = "$key"\n  version = "$version"\n}\n';

class FakeNet {
  FakeNet(this.files);

  final Map<String, String> files;
  final List<String> requested = [];
  final Set<String> failingHosts = {};

  Future<List<int>> get(String url, int maxBytes) async {
    requested.add(url);
    final uri = Uri.parse(url);
    if (failingHosts.contains(uri.host)) throw const MarketException('网络不可达');
    final body = files[url];
    if (body == null) throw const MarketException('HTTP 404');
    return utf8.encode(body);
  }
}

const rawBase = 'https://raw.githubusercontent.com/venera-app/venera-configs/main/';
const jsdBase = 'https://cdn.jsdelivr.net/gh/venera-app/venera-configs@main/';

Map<String, String> catalogFiles(String base, Map<String, String> versions) => {
      '${base}index.json': jsonEncode([
        for (final e in versions.entries) {'name': '源${e.key}', 'fileName': '${e.key}.js', 'key': e.key, 'version': e.value},
      ]),
      for (final e in versions.entries) '$base${e.key}.js': sourceText(e.key, e.value),
    };

Future<String> assetLoader(String key) => File(key).readAsString();

VeneraManager newManager(Directory dir, FakeNet net, {DateTime? now}) => VeneraManager(
      store: VeneraStore(dir),
      fetcher: MirrorFetcher(httpGet: net.get),
      snapshot: VeneraSnapshot(loader: assetLoader),
      clock: () => now ?? DateTime.utc(2025, 1, 1),
    );

Directory tempDir() => Directory.systemTemp.createTempSync('venera-mgr');

void main() {
  group('目录与 id 规则（与桌面 catalog.ts 一致）', () {
    test('内置快照 33 个来源：id=venera-<key>，下载地址=raw/<fileName>，源码 key 与目录一致、脚本版本不低于目录版本', () async {
      final snapshot = VeneraSnapshot(loader: assetLoader);
      final entries = await snapshot.entries();
      expect(entries.length, greaterThanOrEqualTo(30));
      final raw = jsonDecode(File('assets/venera/index.json').readAsStringSync()) as List;
      expect(entries.length, raw.length);
      for (var i = 0; i < raw.length; i++) {
        final item = raw[i] as Map;
        final key = (item['key'] as String).trim();
        final desktopId = 'venera-$key';
        expect(entries[i].id, desktopId);
        expect(entries[i].toJson()['sourceType'], 'venera');
        expect(entries[i].toJson()['engine'], 'venera');
        expect(entries[i].type, 'manga');
        final text = await snapshot.sourceText(entries[i].fileName);
        expect(text, isNotNull, reason: entries[i].fileName);
        expect(validateVeneraSource(text!, expectedKey: key), key, reason: entries[i].fileName);
        final versionDeclared = RegExp(r'''\bversion\s*=\s*["']([^"']+)["']''').firstMatch(text)?.group(1);
        expect(compareSourceVersions(versionDeclared!, entries[i].version), greaterThanOrEqualTo(0), reason: '${entries[i].fileName} 脚本版本不应低于目录版本');
      }
    });

    test('在线目录下载地址与桌面一致', () {
      final entry = VeneraCatalogEntry.fromIndexEntry(
        {'name': '拷贝漫画', 'fileName': 'copy_manga.js', 'key': 'copy_manga', 'version': '1.4.3'},
        rawBase,
      );
      expect(entry.id, 'venera-copy_manga');
      expect(entry.downloadUrl, 'https://raw.githubusercontent.com/venera-app/venera-configs/main/copy_manga.js');
      expect(entry.toJson()['compatibility'], 'experimental');
      expect(entry.toJson()['limitation'], veneraMarketLimitation);
    });

    test('缺 key 时以文件名推导，混合大小写 key 原样保留', () {
      expect(VeneraCatalogEntry.fromIndexEntry({'name': 'x', 'fileName': 'foo.js'}, rawBase).id, 'venera-foo');
      expect(VeneraCatalogEntry.fromIndexEntry({'name': 'x', 'fileName': 'm.js', 'key': 'ManHuaGui'}, rawBase).id, 'venera-ManHuaGui');
    });

    test('无效条目被忽略并给出警告：缺名称、非法 key、路径穿越文件名', () {
      final warnings = <String>[];
      final entries = parseVeneraIndex([
        {'name': '好', 'fileName': 'ok.js', 'key': 'ok', 'version': '1'},
        {'fileName': 'noname.js', 'key': 'noname'},
        {'name': 'bad key', 'fileName': 'x.js', 'key': 'a-b'},
        {'name': 'evil', 'fileName': '../evil.js', 'key': 'evil'},
        'string',
        {'name': '重复', 'fileName': 'ok.js', 'key': 'ok'},
      ], rawBase, warnings: warnings);
      expect(entries.map((e) => e.key), ['ok']);
      expect(warnings.length, 4);
    });

    test('源码校验：缺 class、缺 key、key 不一致', () {
      expect(() => validateVeneraSource('const a = 1'), throwsA(isA<VeneraException>()));
      expect(() => validateVeneraSource('class A extends ComicSource { }'), throwsA(isA<VeneraException>()));
      expect(() => validateVeneraSource(sourceText('a', '1'), expectedKey: 'b'), throwsA(isA<VeneraException>()));
    });

    test('配置提示：账号、设置、网页登录', () async {
      final snapshot = VeneraSnapshot(loader: assetLoader);
      final picacg = VeneraConfigHints.analyze((await snapshot.sourceText('picacg.js'))!);
      expect(picacg.hasAccount, isTrue);
      expect(picacg.needsConfig, isTrue);
      final copy = VeneraConfigHints.analyze((await snapshot.sourceText('copy_manga.js'))!);
      expect(copy.hasWebLogin || copy.hasPasswordLogin, isTrue);
      expect(VeneraConfigHints.analyze(sourceText('plain', '1')).needsConfig, isFalse);
      expect(VeneraConfigHints.fromJson(picacg.toJson()).hasAccount, isTrue);
    });
  });

  group('镜像回退、安装与更新', () {
    test('首个镜像失败回退到下一个并记住成功镜像', () async {
      final net = FakeNet(catalogFiles(jsdBase, {'a': '1.0.0'}))..failingHosts.add('raw.githubusercontent.com');
      final manager = newManager(tempDir(), net);
      final report = await manager.installAllFromCatalog();
      expect(report.count(MarketInstallStatus.installed), 1);
      expect(report.catalogOrigin, jsdBase);
      net.requested.clear();
      await manager.fetchCatalog();
      expect(net.requested.first, startsWith(jsdBase));
    });

    test('全部镜像失败时回落内置快照并给出警告', () async {
      final net = FakeNet({});
      final manager = newManager(tempDir(), net);
      final catalog = await manager.fetchCatalog();
      expect(catalog.isSnapshot, isTrue);
      expect(catalog.warnings.single, contains('所有镜像均失败'));
      final report = await manager.install(catalog, ids: {'venera-copy_manga'});
      expect(report.count(MarketInstallStatus.installed), 1);
      final loaded = await manager.loadInstalled();
      expect(loaded.sources.single.meta.origin, 'snapshot');
      expect(loaded.sources.single.meta.downloadUrl, 'assets/venera/sources/copy_manga.js');
    });

    test('单个来源失败不影响其余，汇总可见失败原因；镜像失败回落快照', () async {
      final files = catalogFiles(rawBase, {'a': '1.0.0', 'b': '1.0.0', 'c': '1.0.0'});
      files['${rawBase}b.js'] = 'not a venera source';
      files.remove('${rawBase}c.js');
      final manager = newManager(tempDir(), FakeNet(files));
      final report = await manager.installAllFromCatalog();
      expect(report.count(MarketInstallStatus.installed), 1);
      expect(report.count(MarketInstallStatus.failed), 2);
      expect(report.failures.map((f) => f.id), containsAll(['venera-b', 'venera-c']));
      expect(report.failures.first.message, contains('下载失败'));
      expect((await manager.loadInstalled()).sources.map((s) => s.meta.id), ['venera-a']);
      expect(report.summary, contains('失败 2'));
    });

    test('镜像中某个来源失败但快照里有同名来源时回落快照', () async {
      final files = catalogFiles(rawBase, {'copy_manga': '1.4.3'});
      files.remove('${rawBase}copy_manga.js');
      final net = FakeNet(files);
      final manager = newManager(tempDir(), net);
      final report = await manager.installAllFromCatalog();
      expect(report.items.single.status, MarketInstallStatus.installed);
      expect(report.items.single.message, contains('内置快照'));
    });

    test('已安装元数据字段与桌面 MarketPlugin / Kazumi 批次对齐，并带 engine 与 type', () async {
      final manager = newManager(tempDir(), FakeNet(catalogFiles(rawBase, {'a': '1.2.0'})));
      await manager.installAllFromCatalog();
      final meta = (await manager.loadInstalled()).sources.single.meta.toJson();
      expect(meta['id'], 'venera-a');
      expect(meta['type'], 'manga');
      expect(meta['sourceType'], 'venera');
      expect(meta['engine'], 'venera');
      expect(meta['version'], '1.2.0');
      expect(meta['downloadUrl'], '${rawBase}a.js');
      expect(meta['catalogUrl'], rawBase);
      expect(meta['enabled'], isTrue);
      expect(meta['origin'], 'mirror');
      expect(meta.keys, containsAll(['installedAt', 'updatedAt', 'hints', 'fileName', 'key']));
    });

    test('脚本原样落盘（逐字节一致）', () async {
      final files = catalogFiles(rawBase, {'a': '1.0.0'});
      final dir = tempDir();
      await newManager(dir, FakeNet(files)).installAllFromCatalog();
      expect(File('${dir.path}/sources/venera-a.js').readAsStringSync(), files['${rawBase}a.js']);
    });

    test('增量更新：未变化不重下，变化的只下载变化项，失败保留旧版', () async {
      final dir = tempDir();
      final net = FakeNet(catalogFiles(rawBase, {'a': '1.0.0', 'b': '1.0.0'}));
      final manager = newManager(dir, net);
      await manager.installAllFromCatalog();
      net.requested.clear();
      var report = await manager.installAllFromCatalog();
      expect(report.count(MarketInstallStatus.upToDate), 2);
      expect(net.requested.where((u) => u.endsWith('.js')), isEmpty);

      net.files.addAll(catalogFiles(rawBase, {'a': '1.1.0', 'b': '2.0.0'}));
      net.files.remove('${rawBase}b.js');
      net.requested.clear();
      report = await manager.installAllFromCatalog();
      expect(report.items.firstWhere((i) => i.id == 'venera-a').status, MarketInstallStatus.updated);
      final b = report.items.firstWhere((i) => i.id == 'venera-b');
      expect(b.status, MarketInstallStatus.failed);
      expect(b.message, contains('保留当前版本 1.0.0'));
      final versions = {for (final s in (await manager.loadInstalled()).sources) s.meta.id: s.meta.version};
      expect(versions, {'venera-a': '1.1.0', 'venera-b': '1.0.0'});
    });

    test('只更新已安装：未安装的新目录项不会被装', () async {
      final net = FakeNet(catalogFiles(rawBase, {'a': '1.0.0'}));
      final manager = newManager(tempDir(), net);
      await manager.installAllFromCatalog();
      net.files.addAll(catalogFiles(rawBase, {'a': '1.0.0', 'new': '1.0.0'}));
      final report = await manager.installAllFromCatalog(onlyInstalled: true);
      expect(report.items.map((i) => i.id), ['venera-a']);
      expect((await manager.loadInstalled()).sources.length, 1);
    });

    test('脚本 key 与目录不一致时拒绝安装', () async {
      final files = catalogFiles(rawBase, {'a': '1.0.0'});
      files['${rawBase}a.js'] = sourceText('other', '1.0.0');
      final report = await newManager(tempDir(), FakeNet(files)).installAllFromCatalog();
      expect(report.count(MarketInstallStatus.failed), 1);
    });

    test('启停与卸载持久化；卸载同时清除该来源的登录数据与 Cookie', () async {
      final dir = tempDir();
      final manager = newManager(dir, FakeNet(catalogFiles(rawBase, {'a': '1.0.0', 'b': '1.0.0'})));
      await manager.installAllFromCatalog();
      await manager.setEnabled('venera-a', false);
      expect((await newManager(dir, FakeNet({})).loadInstalled()).sources.firstWhere((s) => s.meta.id == 'venera-a').meta.enabled, isFalse);
      final store = manager.store;
      await store.writeJsonMap(store.dataFile('venera-a'), {'account': ['u', 'p']});
      await store.writeJsonMap(store.cookieFile('venera-a'), {'cookies': []});
      await manager.uninstall('venera-a');
      expect(store.dataFile('venera-a').existsSync(), isFalse);
      expect(store.cookieFile('venera-a').existsSync(), isFalse);
      expect((await manager.loadInstalled()).sources.map((s) => s.meta.id), ['venera-b']);
      await expectLater(manager.setEnabled('venera-zzz', true), throwsA(isA<VeneraException>()));
    });

    test('重装保留启用状态与 installedAt', () async {
      final net = FakeNet(catalogFiles(rawBase, {'a': '1.0.0'}));
      final dir = tempDir();
      await newManager(dir, net, now: DateTime.utc(2024, 1, 1)).installAllFromCatalog();
      final manager = newManager(dir, net, now: DateTime.utc(2025, 6, 1));
      await manager.setEnabled('venera-a', false);
      net.files.addAll(catalogFiles(rawBase, {'a': '1.0.1'}));
      await manager.installAllFromCatalog();
      final meta = (await manager.loadInstalled()).sources.single.meta;
      expect(meta.enabled, isFalse);
      expect(meta.installedAt, DateTime.utc(2024, 1, 1));
      expect(meta.updatedAt, DateTime.utc(2025, 6, 1));
    });

    test('首次启动无网络也能从内置快照装全部来源（按默认启用策略），只执行一次', () async {
      final dir = tempDir();
      final manager = newManager(dir, FakeNet({}));
      final report = (await manager.seedFromSnapshotIfFirstRun())!;
      expect(report.count(MarketInstallStatus.failed), 0);
      final loaded = await manager.loadInstalled();
      expect(loaded.sources.length, report.count(MarketInstallStatus.installed));
      expect(loaded.sources.every((s) => s.meta.enabled == veneraEnabledByDefault(s.meta.key)), isTrue);
      expect(await manager.seedFromSnapshotIfFirstRun(), isNull);
    });

    test('自定义 HTTPS 目录地址：仅 HTTPS，设置后只用该地址，可恢复默认', () async {
      final custom = 'https://my.example.com/venera/';
      final net = FakeNet(catalogFiles(custom, {'x': '1.0.0'}));
      final manager = newManager(tempDir(), net);
      await expectLater(manager.setCatalogUrl('http://my.example.com/'), throwsA(isA<VeneraException>()));
      await expectLater(manager.setCatalogUrl('https://u:p@my.example.com/'), throwsA(isA<VeneraException>()));
      await manager.setCatalogUrl('https://my.example.com/venera/index.json');
      expect(await manager.catalogBases(), [custom]);
      final report = await manager.installAllFromCatalog();
      expect(report.items.single.id, 'venera-x');
      expect(net.requested.every((u) => u.startsWith(custom)), isTrue);
      await manager.setCatalogUrl('');
      expect(await manager.catalogBases(), defaultVeneraCatalogBases);
    });

    test('损坏的元数据只影响自己', () async {
      final dir = tempDir();
      final manager = newManager(dir, FakeNet(catalogFiles(rawBase, {'a': '1.0.0', 'b': '1.0.0'})));
      await manager.installAllFromCatalog();
      File('${dir.path}/sources/venera-b.meta.json').writeAsStringSync('{broken');
      final loaded = await manager.loadInstalled();
      expect(loaded.sources.map((s) => s.meta.id), ['venera-a']);
      expect(loaded.errors.keys, ['venera-b']);
    });

    test('不安全的来源 ID 被存储层拒绝', () async {
      final store = VeneraStore(tempDir());
      expect(() => store.dataFile('../evil'), throwsA(isA<VeneraException>()));
      expect(() => store.cookieFile('venera-a/b'), throwsA(isA<VeneraException>()));
    });
  });
}
