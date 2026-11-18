import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/venera/venera_catalog.dart';

import 'venera_test_support.dart';

const knownLoadFailures = {'ikmmh'};

void main() {
  final available = quickJsAvailable();

  test('内置快照全部来源脚本可在 QuickJS 中加载并描述（离线，不请求网络）', skip: available ? null : 'QuickJS 本机库不可用', () async {
    final snapshot = VeneraSnapshot(loader: (key) => File(key).readAsString());
    final entries = await snapshot.entries();
    final failures = <String, String>{};
    final summary = <String>[];
    for (final entry in entries) {
      final code = (await snapshot.sourceText(entry.fileName))!;
      final h = SourceHarness.create([], code: code, key: entry.key);
      try {
        final info = await h.source.info();
        summary.add('${entry.key}: search=${info.hasSearch} explore=${info.exploreTitles.length} settings=${info.settings.length} '
            'pwdLogin=${info.canPasswordLogin} webLogin=${info.hasWebLogin} cookieLogin=${info.hasCookieLogin}');
      } catch (error) {
        failures[entry.key] = '$error';
      } finally {
        h.dispose();
      }
    }
    // ignore: avoid_print
    print(summary.join('\n'));
    // ignore: avoid_print
    print('加载失败：$failures');
    expect(failures.keys.toSet(), knownLoadFailures);
  });
}
