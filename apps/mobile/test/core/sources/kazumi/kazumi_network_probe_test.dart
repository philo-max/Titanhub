import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_source.dart';

import 'kazumi_test_support.dart';

const _rules = ['AGE', 'aafun', 'ezdmw', 'giriGiriLove', 'sorani'];
const _keywords = ['葬送的芙莉莲', '名侦探柯南'];

void main() {
  final enabled = Platform.environment['KAZUMI_PROBE'] == '1';

  for (final name in _rules) {
    test(
      '真实搜索探针：$name',
      () async {
        final source = KazumiSource(bundledRule(name));
        addTearDown(source.dispose);
        for (final keyword in _keywords) {
          try {
            final results = await source.search(keyword);
            final first = results.isEmpty ? '-' : '${results.first['title']} -> ${results.first['id']}';
            var chapterNote = '';
            if (results.isNotEmpty) {
              try {
                final chapters = await source.getChapters(results.first['id'] as String);
                chapterNote = ' chapters=${chapters.length}';
              } catch (error) {
                chapterNote = ' chaptersError=$error';
              }
            }
            stdout.writeln('PROBE $name "$keyword": ${results.length} results, first=$first$chapterNote');
          } catch (error) {
            stdout.writeln('PROBE $name "$keyword": ERROR $error');
          }
        }
      },
      skip: enabled ? false : '设置 KAZUMI_PROBE=1 后运行真实网络探针',
      timeout: const Timeout(Duration(minutes: 3)),
    );
  }
}
