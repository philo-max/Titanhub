import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/venera/venera_catalog.dart';
import 'package:titanhub/core/sources/venera/venera_models.dart';
import 'package:titanhub/core/sources/venera/venera_source.dart';
import 'package:titanhub/core/sources/venera/venera_store.dart';

import 'venera_test_support.dart';

final bool probeEnabled = Platform.environment['VENERA_PROBE'] == '1';

final List<String> probeKeys = (Platform.environment['VENERA_PROBE_KEYS'] ?? 'manga_dex,comick,copy_manga,baozi,ykmh,zaimanhua')
    .split(',')
    .where((k) => k.isNotEmpty)
    .toList();

final List<String> probeKeywords = (Platform.environment['VENERA_PROBE_KEYWORDS'] ?? '海贼王,one piece').split(',');

Future<String> probeOne(VeneraSnapshot snapshot, VeneraStore store, String key) async {
  final entry = (await snapshot.entries()).firstWhere((e) => e.key == key);
  final code = (await snapshot.sourceText(entry.fileName))!;
  final meta = InstalledVeneraSource(
    id: entry.id,
    key: entry.key,
    name: entry.name,
    version: entry.version,
    fileName: entry.fileName,
    downloadUrl: '',
    catalogUrl: '',
    enabled: true,
    installedAt: DateTime.now(),
    updatedAt: DateTime.now(),
    hints: VeneraConfigHints.analyze(code),
  );
  final source = VeneraSource(meta, code, store: store);
  final steps = <String>[];
  try {
    List found = const [];
    String usedKeyword = '';
    for (final keyword in probeKeywords) {
      try {
        found = await source.call('search', [keyword]) as List;
      } catch (error) {
        steps.add('search(${keyword}) 失败: $error');
        continue;
      }
      if (found.isNotEmpty) {
        usedKeyword = keyword;
        break;
      }
    }
    steps.add('search "$usedKeyword" -> ${found.length} 条${found.isEmpty ? '' : '，首条「${found.first['title']}」'}');
    if (found.isEmpty) return steps.join(' | ');
    final id = '${found.first['id']}';
    final detail = await source.call('getDetail', [id]) as Map;
    steps.add('detail 「${detail['title']}」 标签${(detail['genres'] as List?)?.length ?? 0}');
    final chapters = await source.call('getChapters', [id]) as List;
    steps.add('chapters ${chapters.length}');
    if (chapters.isEmpty) return steps.join(' | ');
    final candidates = [...chapters.take(3), ...chapters.reversed.take(2)];
    final attempts = <String>[];
    for (final chapter in candidates) {
      try {
        final images = await source.call('getImages', ['${chapter['id']}']) as List;
        final headers = source.imageHeaders('${images.first}');
        steps.add('images ${images.length} 首张 ${Uri.parse('${images.first}').host} 请求头${headers?.keys.where((k) => k != 'User-Agent').toList()}');
        return steps.join(' | ');
      } catch (error) {
        attempts.add('$error');
      }
    }
    steps.add('取图失败(${attempts.length} 章)：${attempts.first}');
    return steps.join(' | ');
  } catch (error) {
    steps.add('失败: $error');
    return steps.join(' | ');
  } finally {
    source.dispose();
  }
}

void main() {
  final skip = !probeEnabled ? '设置 VENERA_PROBE=1 才运行真实网络探针' : (quickJsAvailable() ? null : 'QuickJS 本机库不可用');

  test('真实来源探针：搜索 + 详情 + 章节 + 取一章图片列表', skip: skip, timeout: const Timeout(Duration(minutes: 10)), () async {
    final snapshot = VeneraSnapshot(loader: (key) => File(key).readAsString());
    final store = VeneraStore(Directory.systemTemp.createTempSync('venera-probe'));
    for (final key in probeKeys) {
      final result = await probeOne(snapshot, store, key);
      // ignore: avoid_print
      print('PROBE $key => $result');
    }
  });
}
