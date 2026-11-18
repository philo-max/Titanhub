import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../market/market_infra.dart';
import 'kazumi_models.dart';
import 'kazumi_rule.dart';

const List<String> defaultKazumiCatalogBases = [
  'https://raw.githubusercontent.com/Predidit/KazumiRules/main/',
  'https://cdn.jsdelivr.net/gh/Predidit/KazumiRules@main/',
  'https://fastly.jsdelivr.net/gh/Predidit/KazumiRules@main/',
  'https://gcore.jsdelivr.net/gh/Predidit/KazumiRules@main/',
  'https://testingcf.jsdelivr.net/gh/Predidit/KazumiRules@main/',
  'https://gh-proxy.com/https://raw.githubusercontent.com/Predidit/KazumiRules/main/',
  'https://ghfast.top/https://raw.githubusercontent.com/Predidit/KazumiRules/main/',
];

const int kazumiMaxIndexBytes = 2 * 1024 * 1024;
const int kazumiMaxRuleBytes = 1024 * 1024;
const String kazumiSnapshotIndexAsset = 'assets/kazumi/index.json';
const String kazumiSnapshotRuleDir = 'assets/kazumi/rules/';

String? normalizeKazumiCatalogBase(String input) => normalizeCatalogBase(input);

typedef KazumiHttpGet = MarketHttpGet;

Future<List<int>> dioKazumiHttpGet(String url, int maxBytes, {Dio? dio, Duration timeout = const Duration(seconds: 10)}) =>
    dioMarketHttpGet(url, maxBytes, dio: dio, timeout: timeout);

typedef KazumiFetched = MirrorFetched;

typedef KazumiMirrorException = MirrorException;

class KazumiMirrorFetcher extends MirrorFetcher {
  KazumiMirrorFetcher({KazumiHttpGet? httpGet}) : super(httpGet: httpGet ?? dioKazumiHttpGet);

  Future<KazumiFetched> fetchJson(
    List<String> bases,
    String path, {
    required int maxBytes,
    void Function(Object? json)? validate,
  }) =>
      fetch(
        bases,
        path,
        maxBytes: maxBytes,
        validate: validate == null ? null : (text, json) => validate(json),
      );
}

typedef KazumiAssetLoader = Future<String> Function(String key);

class KazumiSnapshot {
  KazumiSnapshot({KazumiAssetLoader? loader}) : _loader = loader ?? rootBundle.loadString;

  final KazumiAssetLoader _loader;
  List<dynamic>? _index;

  Future<List<dynamic>> index() async {
    final cached = _index;
    if (cached != null) return cached;
    final json = jsonDecode(await _loader(kazumiSnapshotIndexAsset));
    if (json is! List) throw const KazumiRuleException('内置规则快照目录格式错误');
    _index = json;
    return json;
  }

  Future<List<KazumiCatalogEntry>> entries() async {
    final index = await this.index();
    return [for (final item in index) KazumiCatalogEntry.fromIndexEntry(item, kazumiSnapshotRuleDir)];
  }

  Future<String?> ruleText(String name) async {
    try {
      final text = await _loader('$kazumiSnapshotRuleDir$name.json');
      jsonDecode(text);
      return text;
    } catch (_) {
      return null;
    }
  }
}
