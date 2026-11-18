import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_api.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_catalog.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_models.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_rule.dart';

import 'kazumi_test_support.dart';

void main() {
  group('插件 ID 编码与桌面 catalog.ts 一致', () {
    test('slug 规则', () {
      expect(KazumiRule.pluginIdForName('AGE'), 'kazumi-age');
      expect(KazumiRule.pluginIdForName('giriGiriLove'), 'kazumi-girigirilove');
      expect(KazumiRule.pluginIdForName('7sefun'), 'kazumi-7sefun');
      expect(KazumiRule.pluginIdForName('Foo Bar_baz'), 'kazumi-foo-bar-baz');
      expect(KazumiRule.pluginIdForName('番剧站 2'), 'kazumi-番剧站-2');
      expect(KazumiRule.pluginIdForName('---'), 'kazumi-imported-rule');
    });

    test('目录条目 id/version/name/downloadUrl 与桌面 normalizeCatalog 一致', () {
      final entry = KazumiCatalogEntry.fromIndexEntry(
        {'name': 'AGE', 'version': 1.6, 'useNativePlayer': true},
        'https://raw.githubusercontent.com/Predidit/KazumiRules/main/',
      );
      expect(entry.id, 'kazumi-age');
      expect(entry.name, 'AGE');
      expect(entry.version, '1.6');
      expect(entry.sourceType, 'kazumi');
      expect(entry.runtime, 'javascript');
      expect(entry.compatibility, 'compatible');
      expect(entry.downloadUrl, 'https://raw.githubusercontent.com/Predidit/KazumiRules/main/AGE.json');
      expect(KazumiCatalogEntry.fromIndexEntry({'name': 'X Y'}, 'https://a/').downloadUrl, 'https://a/X%20Y.json');
      expect(KazumiCatalogEntry.fromIndexEntry({'name': 'X'}, 'https://a/').version, '1.0.0');
      expect(() => KazumiCatalogEntry.fromIndexEntry({'version': '1'}, 'https://a/'),
          throwsA(isA<KazumiRuleException>()));
      expect(() => KazumiCatalogEntry.fromIndexEntry('x', 'https://a/'),
          throwsA(isA<KazumiRuleException>()));
    });

    test('内置快照 18 份规则全部可解析且 ID 与目录一致', () {
      final index = jsonDecode(File('assets/kazumi/index.json').readAsStringSync()) as List;
      expect(index.length, 18);
      for (final item in index) {
        final entry = KazumiCatalogEntry.fromIndexEntry(item, 'https://a/');
        final rule = bundledRule(entry.name);
        expect(rule.pluginId, entry.id, reason: entry.name);
        expect(rule.version, entry.version, reason: entry.name);
      }
    });

    test('规则 JSON 原样保存不改写', () {
      final raw = bundledRuleJson('ezdmw');
      expect(KazumiRule.fromJson(raw).toJson(), raw);
    });
  });

  group('规则校验', () {
    test('缺少必需字段给出明确错误', () {
      expect(() => KazumiRule.fromJson({'name': 'x'}), throwsA(isA<KazumiRuleException>()));
      expect(() => KazumiRule.fromJson([1]), throwsA(isA<KazumiRuleException>()));
      expect(
        () => KazumiRule.fromJson({
          'name': 'x',
          'baseURL': 'ftp://a',
          'searchURL': 'u',
          'searchList': 'l',
          'searchName': 'n',
          'searchResult': 'r',
        }),
        throwsA(isA<KazumiRuleException>()),
      );
      expect(
        () => KazumiRule.fromJson({'name': 'x', 'baseURL': 'https://a', 'searchMode': 'api'}),
        throwsA(isA<KazumiRuleException>()),
      );
    });

    test('api 规则与 xpath 规则识别', () {
      expect(bundledRule('giriGiriLove').searchMode, 'api');
      expect(bundledRule('giriGiriLove').chapterMode, 'api');
      expect(bundledRule('LMM').chapterMode, 'xpath');
      expect(bundledRule('ezdmw').searchMode, 'xpath');
      expect(bundledRule('AGE').type, 'anime');
    });
  });

  group('版本比较', () {
    test('数字段按数值比较', () {
      expect(compareKazumiVersions('1.10', '1.9'), greaterThan(0));
      expect(compareKazumiVersions('1.2', '1.2.0'), 0);
      expect(compareKazumiVersions('1.3', '1.4'), lessThan(0));
      expect(compareKazumiVersions('2', '1.99'), greaterThan(0));
    });
  });

  group('镜像目录地址', () {
    test('只接受 HTTPS 且规范化为目录', () {
      expect(normalizeKazumiCatalogBase('https://a.com/rules'), 'https://a.com/rules/');
      expect(normalizeKazumiCatalogBase('https://a.com/rules/index.json'), 'https://a.com/rules/');
      expect(normalizeKazumiCatalogBase('http://a.com/rules/'), isNull);
      expect(normalizeKazumiCatalogBase('https://u:p@a.com/'), isNull);
      expect(normalizeKazumiCatalogBase('https://a.com/?x=1'), isNull);
      expect(normalizeKazumiCatalogBase('  '), isNull);
      expect(normalizeKazumiCatalogBase('not a url'), isNull);
    });

    test('默认镜像全部为 HTTPS 且含 jsDelivr', () {
      for (final base in defaultKazumiCatalogBases) {
        expect(base.startsWith('https://'), isTrue);
        expect(base.endsWith('/'), isTrue);
      }
      expect(defaultKazumiCatalogBases.any((b) => b.contains('cdn.jsdelivr.net/gh/Predidit/KazumiRules@main/')),
          isTrue);
    });
  });

  group('JSONPath 与变量替换', () {
    test('支持子集', () {
      final data = {
        'a': {
          'list': [
            {'n': 'x'},
            {'n': 'y'},
          ],
        },
      };
      expect(kazumiJsonPath(data, r'$.a.list[*].n'), ['x', 'y']);
      expect(kazumiJsonPath(data, r'$.a.list[1].n'), ['y']);
      expect(kazumiJsonPath(data, r"$['a'].list[0]"), [
        {'n': 'x'},
      ]);
      expect(kazumiJsonPath(data, r'$.missing.x'), isEmpty);
      expect(() => kazumiJsonPath(data, r'$..a'), throwsA(isA<KazumiRuleException>()));
    });

    test('变量替换与 URL 构造', () {
      final url = kazumiApiUrl('https://s.com', {
        'url': '/api/@source',
        'query': {'wd': '@keyword', 'page': 1},
      }, {'keyword': '芙 莉', 'source': 'a/b'});
      expect(url, 'https://s.com/api/a%2Fb?wd=%E8%8A%99%20%E8%8E%89&page=1');
    });

    test('absolutize 与桌面一致', () {
      expect(absolutizeKazumiUrl('https://s.com/x/', '//c.com/a'), 'https://c.com/a');
      expect(absolutizeKazumiUrl('https://s.com/x/', 'https://c.com/a'), 'https://c.com/a');
      expect(absolutizeKazumiUrl('https://s.com/x/', '/a'), 'https://s.com/a');
      expect(absolutizeKazumiUrl('https://s.com/x/', 'a/b'), 'https://s.com/x/a/b');
      expect(absolutizeKazumiUrl('https://s.com', ''), '');
    });
  });
}
