import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sandbox/local_plugin_runner.dart';
import 'package:titanhub/core/sources/media_source.dart';
import 'package:titanhub/core/sources/unified/source_health.dart';

class _FakeRunner extends LocalPluginRunner {
  final queries = <String, String>{};
  final delays = <String, Duration>{};
  final errors = <String, Object>{};
  final counts = <String, int>{};

  @override
  Future<dynamic> call(String pluginId, String method, List<dynamic> args) async {
    queries[pluginId] = args.first.toString();
    final delay = delays[pluginId];
    if (delay != null) {
      await Future<void>.delayed(delay);
    }
    final err = errors[pluginId];
    if (err != null) throw err;
    final count = counts[pluginId] ?? 1;
    return [
      for (var i = 0; i < count; i++) {'id': '$pluginId-$i', 'title': 'Item $i'},
    ];
  }
}

void main() {
  test('probeQueryForSource selects appropriate probe keyword by source type', () {
    const md = MediaSource(
      id: 'mangadex',
      name: 'MangaDex',
      types: ['manga'],
      capabilities: {MediaCapability.search},
    );
    const manga = MediaSource(
      id: 'venera-a',
      name: '漫画A',
      types: ['manga'],
      capabilities: {MediaCapability.search},
    );
    const anime = MediaSource(
      id: 'kazumi-a',
      name: '动漫A',
      types: ['anime'],
      capabilities: {MediaCapability.search},
    );

    expect(probeQueryForSource(md), 'Yotsuba');
    expect(probeQueryForSource(manga), '鬼灭');
    expect(probeQueryForSource(anime), '柯南');
  });

  test('probeAllSources classifies healthy/empty/failed, sorts by status+latency, and skips non-search', () async {
    final runner = _FakeRunner()
      ..delays['slow-ok'] = const Duration(milliseconds: 60)
      ..delays['fast-ok'] = const Duration(milliseconds: 5)
      ..counts['empty-src'] = 0
      ..errors['err-src'] = StateError('403 Forbidden')
      ..delays['timeout-src'] = const Duration(milliseconds: 200);

    const sources = [
      MediaSource(
        id: 'no-search',
        name: '无搜索',
        types: ['anime'],
        capabilities: {MediaCapability.detail},
      ),
      MediaSource(
        id: 'slow-ok',
        name: '慢速可用',
        types: ['anime'],
        capabilities: {MediaCapability.search},
      ),
      MediaSource(
        id: 'err-src',
        name: '报错源',
        types: ['manga'],
        capabilities: {MediaCapability.search},
      ),
      MediaSource(
        id: 'empty-src',
        name: '空结果源',
        types: ['manga'],
        capabilities: {MediaCapability.search},
      ),
      MediaSource(
        id: 'timeout-src',
        name: '超时源',
        types: ['anime'],
        capabilities: {MediaCapability.search},
      ),
      MediaSource(
        id: 'fast-ok',
        name: '极速可用',
        types: ['anime'],
        capabilities: {MediaCapability.search},
      ),
    ];

    final progress = <int>[];
    final results = await probeAllSources(
      sources: sources,
      runner: runner,
      timeout: const Duration(milliseconds: 100),
      concurrency: 3,
      onProgress: (_, completed, total) {
        expect(total, 5);
        progress.add(completed);
      },
    );

    expect(progress, [1, 2, 3, 4, 5]);
    expect(runner.queries.containsKey('no-search'), isFalse);
    expect(runner.queries['empty-src'], '鬼灭');
    expect(runner.queries['fast-ok'], '柯南');

    expect(results.map((r) => r.id).toList(), [
      'fast-ok',
      'slow-ok',
      'empty-src',
      'err-src',
      'timeout-src',
    ]);
    expect(results[0].status, SourceHealthStatus.healthy);
    expect(results[1].status, SourceHealthStatus.healthy);
    expect(results[0].latencyMs <= results[1].latencyMs, isTrue);
    expect(results[2].status, SourceHealthStatus.empty);
    expect(results[3].status, SourceHealthStatus.failed);
    expect(results[3].error, contains('403 Forbidden'));
    expect(results[4].status, SourceHealthStatus.failed);
    expect(results[4].error, contains('TimeoutException'));
  });
}
