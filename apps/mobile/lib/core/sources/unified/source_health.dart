import 'dart:async';
import 'dart:math' as math;

import '../../sandbox/local_plugin_runner.dart';
import '../media_source.dart';

enum SourceHealthStatus {
  healthy,
  empty,
  failed,
}

class SourceHealthResult {
  const SourceHealthResult({
    required this.id,
    required this.name,
    required this.status,
    required this.latencyMs,
    this.resultCount = 0,
    this.error,
  });

  final String id;
  final String name;
  final SourceHealthStatus status;
  final int latencyMs;
  final int resultCount;
  final String? error;
}

String probeQueryForSource(MediaSource source) {
  if (source.id == 'mangadex') return 'Yotsuba';
  if (source.types.contains('manga')) return '鬼灭';
  return '柯南';
}

/// Probes all searchable [sources] with bounded concurrency and returns results
/// sorted by health status (`healthy` -> `empty` -> `failed`) and latency.
Future<List<SourceHealthResult>> probeAllSources({
  required List<MediaSource> sources,
  required LocalPluginRunner runner,
  Duration timeout = const Duration(seconds: 8),
  int concurrency = 6,
  void Function(SourceHealthResult result, int completed, int total)? onProgress,
}) async {
  final targets = [
    for (final s in sources)
      if (s.supports(MediaCapability.search)) s,
  ];
  if (targets.isEmpty) return const [];

  final results = List<SourceHealthResult?>.filled(targets.length, null);
  var nextIndex = 0;
  var completed = 0;

  Future<void> worker() async {
    while (true) {
      final index = nextIndex++;
      if (index >= targets.length) return;
      final source = targets[index];
      final sw = Stopwatch()..start();
      SourceHealthResult result;
      try {
        final raw = await runner
            .call(source.id, 'search', [probeQueryForSource(source)])
            .timeout(timeout);
        sw.stop();
        final count = raw is List ? raw.length : 0;
        result = SourceHealthResult(
          id: source.id,
          name: source.name,
          status: count > 0
              ? SourceHealthStatus.healthy
              : SourceHealthStatus.empty,
          latencyMs: sw.elapsedMilliseconds,
          resultCount: count,
        );
      } catch (e) {
        sw.stop();
        result = SourceHealthResult(
          id: source.id,
          name: source.name,
          status: SourceHealthStatus.failed,
          latencyMs: sw.elapsedMilliseconds,
          error: e.toString(),
        );
      }
      results[index] = result;
      completed++;
      onProgress?.call(result, completed, targets.length);
    }
  }

  final workerCount = math.max(1, math.min(concurrency, targets.length));
  await Future.wait([for (var i = 0; i < workerCount; i++) worker()]);

  final list = results.whereType<SourceHealthResult>().toList();
  list.sort((a, b) {
    final statusCmp = a.status.index.compareTo(b.status.index);
    if (statusCmp != 0) return statusCmp;
    return a.latencyMs.compareTo(b.latencyMs);
  });
  return list;
}
