import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_catalog.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_manager.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_models.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_rule.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_store.dart';

import 'kazumi_test_support.dart';

const _raw = 'https://raw.githubusercontent.com/Predidit/KazumiRules/main/';
const _cdn = 'https://cdn.jsdelivr.net/gh/Predidit/KazumiRules@main/';

class _Net {
  final Map<String, String> responses = {};
  final Set<String> failingHosts = {};
  final List<String> requested = [];

  Future<List<int>> get(String url, int maxBytes) async {
    requested.add(url);
    final host = Uri.parse(url).host;
    if (failingHosts.contains(host)) throw const KazumiRuleException('网络不可达');
    final body = responses[url];
    if (body == null) throw const KazumiRuleException('HTTP 404');
    return utf8.encode(body);
  }

  void serve(String base, List<Map<String, dynamic>> rules, {Map<String, String> versions = const {}}) {
    responses['${base}index.json'] = jsonEncode([
      for (final rule in rules)
        {'name': rule['name'], 'version': versions[rule['name']] ?? rule['version']},
    ]);
    for (final rule in rules) {
      responses['$base${Uri.encodeComponent(rule['name'] as String)}.json'] = jsonEncode(rule);
    }
  }
}

Map<String, dynamic> _rule(String name, String version) => {
      'api': '1',
      'type': 'anime',
      'name': name,
      'version': version,
      'baseURL': 'https://$name.example.com/',
      'searchURL': 'https://$name.example.com/s?q=@keyword',
      'searchList': '//li',
      'searchName': '//a',
      'searchResult': '//a',
      'chapterRoads': '//ul',
      'chapterResult': '//a',
    };

void main() {
  late Directory dir;
  late _Net net;
  var clock = DateTime.utc(2026, 1, 1);

  KazumiRuleManager manager({Set<String> reserved = const {}}) => KazumiRuleManager(
        store: KazumiRuleStore(dir),
        fetcher: KazumiMirrorFetcher(httpGet: net.get),
        snapshot: KazumiSnapshot(loader: assetLoader),
        clock: () => clock,
        reservedIds: reserved,
      );

  setUp(() {
    dir = Directory.systemTemp.createTempSync('kazumi-manager-test');
    net = _Net();
    clock = DateTime.utc(2026, 1, 1);
  });

  tearDown(() => dir.deleteSync(recursive: true));

  group('镜像回退', () {
    test('前面的镜像失败/返回非 JSON 时依次回退到可用镜像', () async {
      net.failingHosts.add('raw.githubusercontent.com');
      net.responses['${_cdn}index.json'] = '<html>blocked</html>';
      net.serve(defaultKazumiCatalogBases[2], [_rule('alpha', '1.0')]);
      final catalog = await manager().fetchCatalog();
      expect(catalog.origin, defaultKazumiCatalogBases[2]);
      expect(catalog.entries.single.id, 'kazumi-alpha');
      expect(catalog.entries.single.downloadUrl, '${defaultKazumiCatalogBases[2]}alpha.json');
      expect(net.requested.take(3).map((u) => Uri.parse(u).host).toList(),
          ['raw.githubusercontent.com', 'cdn.jsdelivr.net', 'fastly.jsdelivr.net']);
    });

    test('成功镜像被记住并优先使用', () async {
      net.failingHosts.add('raw.githubusercontent.com');
      net.serve(_cdn, [_rule('alpha', '1.0')]);
      final m = manager();
      await m.fetchCatalog();
      net.requested.clear();
      await m.fetchCatalog();
      expect(Uri.parse(net.requested.first).host, 'cdn.jsdelivr.net');
    });

    test('全部镜像失败时使用内置快照，并带警告', () async {
      for (final base in defaultKazumiCatalogBases) {
        net.failingHosts.add(Uri.parse(base).host);
      }
      final catalog = await manager().fetchCatalog();
      expect(catalog.isSnapshot, isTrue);
      expect(catalog.entries.length, 18);
      expect(catalog.warnings.single, contains('内置快照'));
    });

    test('目录含无效条目时忽略并告警，不影响其余条目', () async {
      net.responses['${_raw}index.json'] = jsonEncode([
        {'name': 'alpha', 'version': '1'},
        {'version': '2'},
        'bad',
        {'name': 'alpha', 'version': '9'},
      ]);
      final catalog = await manager().fetchCatalog();
      expect(catalog.entries.map((e) => e.id), ['kazumi-alpha']);
      expect(catalog.warnings.length, 2);
    });

    test('自定义目录地址只用于自身，非 HTTPS 被拒绝', () async {
      final m = manager();
      await expectLater(m.setCatalogUrl('http://evil.com/'), throwsA(isA<KazumiRuleException>()));
      await m.setCatalogUrl('https://my.example.com/rules');
      net.serve('https://my.example.com/rules/', [_rule('beta', '2')]);
      final catalog = await m.fetchCatalog();
      expect(catalog.entries.single.id, 'kazumi-beta');
      expect(net.requested.every((u) => u.startsWith('https://my.example.com/rules/')), isTrue);
      await m.setCatalogUrl('');
      expect(await m.catalogBases(), defaultKazumiCatalogBases);
    });
  });

  group('安装与持久化', () {
    test('批量安装：单个规则失败不影响其余，结果汇总失败原因', () async {
      net.serve(_raw, [_rule('alpha', '1.0'), _rule('beta', '1.0'), _rule('gamma', '1.0')]);
      net.responses.remove('${_raw}beta.json');
      net.responses['${_raw}gamma.json'] = '{"name":"gamma"}';
      for (final base in defaultKazumiCatalogBases.skip(1)) {
        net.failingHosts.add(Uri.parse(base).host);
      }
      final report = await manager().installAllFromCatalog();
      expect(report.items.firstWhere((i) => i.id == 'kazumi-alpha').status, KazumiInstallStatus.installed);
      final beta = report.items.firstWhere((i) => i.id == 'kazumi-beta');
      expect(beta.status, KazumiInstallStatus.failed);
      expect(beta.message, contains('HTTP 404'));
      final gamma = report.items.firstWhere((i) => i.id == 'kazumi-gamma');
      expect(gamma.status, KazumiInstallStatus.failed);
      expect(report.count(KazumiInstallStatus.installed), 1);
      expect(report.failures.length, 2);
      final loaded = await manager().loadInstalled();
      expect(loaded.rules.map((r) => r.meta.id), ['kazumi-alpha']);
    });

    test('元数据字段与桌面 MarketPlugin 对齐，规则原样落盘，重启后可加载', () async {
      final rule = _rule('alpha', '1.0');
      net.serve(_raw, [rule]);
      await manager().installAllFromCatalog();
      final stored = (await manager().loadInstalled()).rules.single;
      final json = stored.meta.toJson();
      expect(json['id'], 'kazumi-alpha');
      expect(json['name'], 'alpha');
      expect(json['version'], '1.0');
      expect(json['sourceType'], 'kazumi');
      expect(json['type'], 'anime');
      expect(json['enabled'], isTrue);
      expect(json['downloadUrl'], '${_raw}alpha.json');
      expect(json['catalogUrl'], _raw);
      expect(json['installedAt'], '2026-01-01T00:00:00.000Z');
      expect(stored.rule.toJson(), rule);
      final onDisk = File('${dir.path}/rules/kazumi-alpha.json').readAsStringSync();
      expect(onDisk, jsonEncode(rule));
      expect(InstalledKazumiSource.fromJson(json).toJson(), json);
    });

    test('增量更新：只重新下载版本变化的规则', () async {
      net.serve(_raw, [_rule('alpha', '1.0'), _rule('beta', '1.0')]);
      final m = manager();
      await m.installAllFromCatalog();
      clock = DateTime.utc(2026, 2, 1);
      net.requested.clear();
      net.serve(_raw, [_rule('alpha', '1.0'), _rule('beta', '1.1')]);
      final report = await m.installAllFromCatalog();
      expect(report.items.firstWhere((i) => i.id == 'kazumi-alpha').status, KazumiInstallStatus.upToDate);
      expect(report.items.firstWhere((i) => i.id == 'kazumi-beta').status, KazumiInstallStatus.updated);
      expect(net.requested.where((u) => u.endsWith('alpha.json')), isEmpty);
      final beta = (await m.loadInstalled()).rules.firstWhere((r) => r.meta.id == 'kazumi-beta').meta;
      expect(beta.version, '1.1');
      expect(beta.installedAt, DateTime.utc(2026, 1, 1));
      expect(beta.updatedAt, DateTime.utc(2026, 2, 1));
    });

    test('更新失败保留当前版本', () async {
      net.serve(_raw, [_rule('alpha', '1.0')]);
      final m = manager();
      await m.installAllFromCatalog();
      net.serve(_raw, [_rule('alpha', '1.0')], versions: {'alpha': '2.0'});
      net.responses.remove('${_raw}alpha.json');
      for (final base in defaultKazumiCatalogBases.skip(1)) {
        net.failingHosts.add(Uri.parse(base).host);
      }
      net.responses['${_raw}index.json'] = jsonEncode([
        {'name': 'alpha', 'version': '2.0'},
      ]);
      final report = await m.installAllFromCatalog();
      expect(report.items.single.status, KazumiInstallStatus.failed);
      expect(report.items.single.message, contains('保留当前版本 1.0'));
      expect((await m.loadInstalled()).rules.single.meta.version, '1.0');
    });

    test('onlyInstalled 只更新已装规则，不新增', () async {
      net.serve(_raw, [_rule('alpha', '1.0')]);
      final m = manager();
      await m.installAllFromCatalog();
      net.serve(_raw, [_rule('alpha', '1.0'), _rule('beta', '1.0')]);
      final report = await m.installAllFromCatalog(onlyInstalled: true);
      expect(report.items.map((i) => i.id), ['kazumi-alpha']);
      expect((await m.loadInstalled()).rules.length, 1);
    });

    test('规则身份与目录不一致时拒绝安装', () async {
      net.serve(_raw, [_rule('alpha', '1.0')]);
      net.responses['${_raw}alpha.json'] = jsonEncode(_rule('other', '1.0'));
      for (final base in defaultKazumiCatalogBases.skip(1)) {
        net.failingHosts.add(Uri.parse(base).host);
      }
      final report = await manager().installAllFromCatalog();
      expect(report.items.single.status, KazumiInstallStatus.failed);
      expect(report.items.single.message, contains('不一致'));
    });

    test('与内置来源同身份的规则被跳过', () async {
      net.serve(_raw, [_rule('7sefun', '1.0')]);
      final report = await manager(reserved: {'kazumi-7sefun'}).installAllFromCatalog();
      expect(report.items.single.status, KazumiInstallStatus.skipped);
      expect((await manager().loadInstalled()).rules, isEmpty);
    });

    test('启停与卸载持久化，且保留版本与安装时间', () async {
      net.serve(_raw, [_rule('alpha', '1.0'), _rule('beta', '1.0')]);
      final m = manager();
      await m.installAllFromCatalog();
      await m.setEnabled('kazumi-alpha', false);
      await m.uninstall('kazumi-beta');
      final loaded = (await manager().loadInstalled()).rules;
      expect(loaded.map((r) => r.meta.id), ['kazumi-alpha']);
      expect(loaded.single.meta.enabled, isFalse);
      expect(loaded.single.meta.version, '1.0');
      clock = DateTime.utc(2026, 3, 1);
      net.serve(_raw, [_rule('alpha', '1.2')]);
      await m.installAllFromCatalog();
      expect((await m.loadInstalled()).rules.single.meta.enabled, isFalse);
      await expectLater(m.setEnabled('kazumi-missing', true), throwsA(isA<KazumiRuleException>()));
    });

    test('损坏的已安装规则被报告而不影响其他规则', () async {
      net.serve(_raw, [_rule('alpha', '1.0'), _rule('beta', '1.0')]);
      final m = manager();
      await m.installAllFromCatalog();
      File('${dir.path}/rules/kazumi-beta.json').writeAsStringSync('{broken');
      final loaded = await m.loadInstalled();
      expect(loaded.rules.map((r) => r.meta.id), ['kazumi-alpha']);
      expect(loaded.errors.keys, ['kazumi-beta']);
    });
  });

  group('内置快照', () {
    test('首次启动离线安装全部快照规则，之后不再重复', () async {
      final m = manager();
      final report = await m.seedFromSnapshotIfFirstRun();
      expect(report!.count(KazumiInstallStatus.installed), 18);
      expect(net.requested, isEmpty);
      expect((await m.loadInstalled()).rules.length, 18);
      expect((await m.loadInstalled()).rules.first.meta.origin, kazumiSnapshotOrigin);
      await m.uninstall('kazumi-age');
      expect(await m.seedFromSnapshotIfFirstRun(), isNull);
      expect((await m.loadInstalled()).rules.length, 17);
    });

    test('在线目录不可用时安装自动落到快照规则', () async {
      for (final base in defaultKazumiCatalogBases) {
        net.failingHosts.add(Uri.parse(base).host);
      }
      final report = await manager(reserved: {'kazumi-7sefun'}).installAllFromCatalog();
      expect(report.catalogOrigin, kazumiSnapshotOrigin);
      expect(report.count(KazumiInstallStatus.installed), 17);
      expect(report.count(KazumiInstallStatus.skipped), 1);
    });

    test('规则文件镜像失败但目录可用时回退快照规则并注明', () async {
      final snapshotIndex = jsonDecode(File('assets/kazumi/index.json').readAsStringSync()) as List;
      net.responses['${_raw}index.json'] = jsonEncode(snapshotIndex);
      final report = await manager(reserved: {'kazumi-7sefun'}).install(
        await manager().fetchCatalog(),
        ids: {'kazumi-age'},
      );
      expect(report.items.single.status, KazumiInstallStatus.installed);
      expect(report.items.single.message, contains('内置快照'));
      final stored = (await manager().loadInstalled()).rules.single;
      expect(stored.meta.origin, kazumiSnapshotOrigin);
      expect(stored.meta.downloadUrl, startsWith('assets/kazumi/rules/'));
    });

    test('快照之后联网发现新版本会更新', () async {
      final m = manager();
      await m.seedFromSnapshotIfFirstRun();
      final rule = bundledRuleJson('AGE');
      final newer = {...rule, 'version': '99.0'};
      net.serve(_raw, [newer]);
      final report = await m.installAllFromCatalog(onlyInstalled: true);
      expect(report.items.single.status, KazumiInstallStatus.updated);
      final age = (await m.loadInstalled()).rules.firstWhere((r) => r.meta.id == 'kazumi-age').meta;
      expect(age.version, '99.0');
      expect(age.origin, 'mirror');
    });
  });
}
