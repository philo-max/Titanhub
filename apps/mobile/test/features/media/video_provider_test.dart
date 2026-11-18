import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/playback/video_resolver.dart';
import 'package:titanhub/core/sandbox/local_plugin_runner.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/core/sources/media_source.dart';
import 'package:titanhub/features/media/providers/media_providers.dart';

class _PageSource extends LocalPluginRunner {
  @override
  Future<dynamic> call(String pluginId, String method, List<dynamic> args) async => [
        {'quality': '默认', 'url': 'https://anime.test/play/1', 'type': 'page'},
      ];
}

class _Probe implements PageProbe {
  final disposed = Completer<void>();

  @override
  Future<void> dispose() async {
    if (!disposed.isCompleted) disposed.complete();
  }
}

ProviderContainer _container(PageProbeFactory factory) {
  return ProviderContainer(overrides: [
    localSourcesProvider.overrideWithValue(const [
      MediaSource(id: 'test-anime', name: 'test', types: ['anime'],
          capabilities: {MediaCapability.video}),
    ]),
    localPluginRunnerProvider.overrideWithValue(_PageSource()),
    videoResolverProvider.overrideWithValue(VideoResolver(probeFactory: factory)),
  ]);
}

void main() {
  const argument = (pluginId: 'test-anime', chapterId: 'episode-1');

  test('video provider resolves a page before exposing it to the native player', () async {
    final probe = _Probe();
    final container = _container((request, onCandidate) async {
      onCandidate(const MediaCandidate(url: 'https://cdn.test/episode.m3u8?sig=a%2Bb',
          referer: 'https://anime.test/frame', userAgent: 'mobile-test'));
      return probe;
    });
    addTearDown(container.dispose);
    final provider = mediaVideoSourcesProvider(argument);
    final subscription = container.listen(provider, (_, __) {});
    addTearDown(subscription.close);
    final result = await container.read(provider.future);
    expect(result.single.isPage, isFalse);
    expect(result.single.url, 'https://cdn.test/episode.m3u8?sig=a%2Bb');
    expect(headerValue(result.single.headers, 'Referer'), 'https://anime.test/frame');
    expect(headerValue(result.single.headers, 'User-Agent'), 'mobile-test');
    await probe.disposed.future;
  });

  test('leaving the watched video provider cancels and destroys its page probe', () async {
    final probe = _Probe();
    final started = Completer<void>();
    final container = _container((request, onCandidate) async {
      started.complete();
      return probe;
    });
    addTearDown(container.dispose);
    final provider = mediaVideoSourcesProvider(argument);
    final subscription = container.listen(provider, (_, __) {});
    final failure = expectLater(container.read(provider.future),
        throwsA(isA<VideoResolveException>()));
    await started.future;
    subscription.close();
    await container.pump();
    await failure;
    await probe.disposed.future;
  });
}
