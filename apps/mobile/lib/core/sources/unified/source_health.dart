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

String _compactError(Object e) {
  final raw = e.toString().replaceFirst(RegExp(r'^Exception:\s*'), '').trim();
  if (raw.length <= 42) return raw;
  return '${raw.substring(0, 42)}…';
}

/// Probes all searchable [sources] end-to-end (`search` -> `getChapters` ->
/// `getImages` / `getVideoUrl` when supported) with bounded concurrency.
Future<List<SourceHealthResult>> probeAllSources({
  required List<MediaSource> sources,
  required LocalPluginRunner runner,
  Duration timeout = const Duration(seconds: 10),
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
        final items = raw is List ? raw : const [];
        if (items.isEmpty) {
          sw.stop();
          result = SourceHealthResult(
            id: source.id,
            name: source.name,
            status: SourceHealthStatus.empty,
            latencyMs: sw.elapsedMilliseconds,
            resultCount: 0,
          );
        } else {
          final firstItem = items.first;
          final firstId = firstItem is Map ? '${firstItem['id'] ?? ''}' : '';
          String? chainWarning;
          if (firstId.isNotEmpty && source.supports(MediaCapability.chapters)) {
            final chRaw = await runner
                .call(source.id, 'getChapters', [firstId])
                .timeout(timeout);
            final chapters = chRaw is List ? chRaw : const [];
            if (chapters.isEmpty) {
              chainWarning = '无章节';
            } else {
              final firstCh = chapters.first;
              final firstChId =
                  firstCh is Map ? '${firstCh['id'] ?? ''}' : '';
              if (firstChId.isNotEmpty &&
                  source.supports(MediaCapability.images)) {
                final imgRaw = await runner
                    .call(source.id, 'getImages', [firstChId])
                    .timeout(timeout);
                if (imgRaw is! List || imgRaw.isEmpty) {
                  chainWarning = '章节无图';
                }
              } else if (firstChId.isNotEmpty &&
                  source.supports(MediaCapability.video)) {
                final vidRaw = await runner
                    .call(source.id, 'getVideoUrl', [firstChId])
                    .timeout(timeout);
                if (vidRaw is! List || vidRaw.isEmpty) {
                  chainWarning = '无播放地址';
                }
              }
            }
          }
          sw.stop();
          result = SourceHealthResult(
            id: source.id,
            name: source.name,
            status: chainWarning == null
                ? SourceHealthStatus.healthy
                : SourceHealthStatus.empty,
            latencyMs: sw.elapsedMilliseconds,
            resultCount: items.length,
            error: chainWarning,
          );
        }
      } catch (e) {
        sw.stop();
        result = SourceHealthResult(
          id: source.id,
          name: source.name,
          status: SourceHealthStatus.failed,
          latencyMs: sw.elapsedMilliseconds,
          error: _compactError(e),
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
