import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/playback/video_resolver.dart';
import 'package:titanhub/features/media/models/media_models.dart';

const _page = 'https://www.7sefun.top/play/100-1-1.html';
const _signedHls = 'https://cdn.example.com/hls/index.m3u8?sign=a%2Bb&t=1700000000&e=60';

class FakeProbe implements PageProbe {
  FakeProbe(this.request, this.emit);

  final PageProbeRequest request;
  final void Function(MediaCandidate candidate) emit;
  int disposeCount = 0;

  @override
  Future<void> dispose() async => disposeCount++;
}

class FakeProbeFactory {
  final probes = <FakeProbe>[];
  Completer<void>? gate;
  Object? error;
  int calls = 0;

  Future<PageProbe> call(
    PageProbeRequest request,
    void Function(MediaCandidate candidate) onCandidate,
  ) async {
    calls++;
    if (gate != null) await gate!.future;
    if (error != null) throw error!;
    final probe = FakeProbe(request, onCandidate);
    probes.add(probe);
    return probe;
  }
}

VideoSource _pageSource({Map<String, String> headers = const {}}) =>
    VideoSource(quality: '线路1', url: _page, type: VideoSource.typePage, headers: headers);

Future<void> _settle() => Future<void>.delayed(const Duration(milliseconds: 5));

Matcher _failsWith(VideoResolveFailure failure) => throwsA(
      isA<VideoResolveException>().having((e) => e.failure, 'failure', failure),
    );

void main() {
  group('URL 过滤', () {
    test('只允许 HTTP(S)', () {
      expect(isAllowedWebUrl('https://a.example/x'), isTrue);
      expect(isAllowedWebUrl('http://a.example/x'), isTrue);
      for (final bad in ['file:///sdcard/a.mp4', 'content://media/1', 'javascript:alert(1)',
          'intent://x#Intent;end', 'blob:https://a/1', 'data:text/html,x', 'https://', '', null]) {
        expect(isAllowedWebUrl(bad), isFalse, reason: '$bad');
      }
      expect(isAllowedNavigation('about:blank'), isTrue);
      expect(isAllowedNavigation('market://details?id=x'), isFalse);
    });

    test('按扩展名识别 m3u8/mp4，分片与网页不算媒体', () {
      expect(classifyMediaUrl(_signedHls), MediaCandidateKind.hls);
      expect(classifyMediaUrl('https://a.example/v/1.MP4?x=1'), MediaCandidateKind.file);
      expect(classifyMediaUrl('https://a.example/seg-001.ts'), isNull);
      expect(classifyMediaUrl('https://a.example/player.html?url=a.m3u8'), isNull);
      expect(classifyMediaUrl('https://a.example/stream?id=1', hint: MediaCandidateKind.hls),
          MediaCandidateKind.hls);
    });

    test('广告与坏地址被过滤', () {
      expect(classifyMediaUrl('https://pagead2.googlesyndication.com/a.mp4'), isNull);
      expect(classifyMediaUrl('https://googleads.g.doubleclick.net/v.m3u8'), isNull);
      expect(classifyMediaUrl('https://a.example/prestrain.html?u=a.m3u8'), isNull);
      expect(classifyMediaUrl('not a url .m3u8'), isNull);
      expect(classifyMediaUrl('file:///a.m3u8'), isNull);
    });

    test('从 iframe 播放器参数提取嵌入媒体地址', () {
      final encoded = Uri.encodeComponent(_signedHls);
      expect(embeddedMediaUrl('https://player.example/jx/?url=$encoded'), _signedHls);
      expect(embeddedMediaUrl('https://player.example/jx/?url=javascript:a.m3u8'), isNull);
      expect(embeddedMediaUrl('https://player.example/jx/?id=1'), isNull);
    });

    test('桥接消息解析不信任字段类型', () {
      final candidate = candidateFromBridgeMessage({
        'kind': 'hls', 'url': _signedHls, 'frame': 'https://player.example/p', 'ua': 'UA/2',
      });
      expect(candidate?.kind, MediaCandidateKind.hls);
      expect(candidate?.referer, 'https://player.example/p');
      expect(candidate?.userAgent, 'UA/2');
      expect(candidateFromBridgeMessage({'kind': 'other', 'url': _signedHls}), isNull);
      expect(candidateFromBridgeMessage({'kind': 'hls', 'url': 3}), isNull);
      expect(candidateFromBridgeMessage('https://a/b.m3u8'), isNull);
    });

    test('页面请求头剥离 UA，大小写不敏感读取', () {
      const request = PageProbeRequest(pageUrl: _page, headers: {'referer': 'https://r/', 'user-agent': 'UA'});
      expect(request.userAgent, 'UA');
      expect(request.requestHeaders, {'referer': 'https://r/'});
    });
  });

  group('VideoResolver', () {
    test('直链直接返回且不创建 WebView', () async {
      final factory = FakeProbeFactory();
      final resolver = VideoResolver(probeFactory: factory.call);
      final direct = VideoSource(quality: '1080P', url: 'https://a.example/v.mp4');
      expect(await resolver.resolve(direct), same(direct));
      expect(factory.probes, isEmpty);
    });

    test('非 HTTP(S) 地址拒绝', () async {
      final resolver = VideoResolver(probeFactory: FakeProbeFactory().call);
      final bad = VideoSource(quality: '', url: 'file:///sdcard/a.html', type: VideoSource.typePage);
      await expectLater(resolver.resolve(bad), _failsWith(VideoResolveFailure.unsupportedUrl));
    });

    test('网络观察到 m3u8 时保留完整签名 query、实际 Referer/UA 并销毁 WebView', () async {
      final factory = FakeProbeFactory();
      final resolver = VideoResolver(probeFactory: factory.call);
      final future = resolver.resolve(_pageSource(headers: {'Referer': 'https://www.7sefun.top/', 'User-Agent': 'SiteUA'}));
      await _settle();
      final probe = factory.probes.single;
      expect(probe.request.pageUrl, _page);
      probe.emit(networkCandidate('https://ads.example/banner.png', {'Referer': _page}));
      probe.emit(networkCandidate(_signedHls, {'Referer': 'https://player.example/p', 'User-Agent': 'RealUA'}));
      final result = await future;
      expect(result.url, _signedHls);
      expect(result.type, VideoSource.typeDirect);
      expect(result.quality, '线路1');
      expect(result.headers, {'Referer': 'https://player.example/p', 'User-Agent': 'RealUA'});
      expect(result.headers.keys, isNot(contains('Cookie')));
      await _settle();
      expect(probe.disposeCount, 1);
      expect(resolver.activeProbes, 0);
    });

    test('缺少请求 Referer 时回落为播放页，UA 回落为桥接观察值', () async {
      final factory = FakeProbeFactory();
      final resolver = VideoResolver(probeFactory: factory.call);
      final future = resolver.resolve(_pageSource());
      await _settle();
      final probe = factory.probes.single;
      probe.emit(const MediaCandidate(url: 'https://player.example/', kind: MediaCandidateKind.iframe, userAgent: 'WebViewUA'));
      probe.emit(networkCandidate(_signedHls, const {}));
      final result = await future;
      expect(result.headers, {'Referer': _page, 'User-Agent': 'WebViewUA'});
    });

    test('mp4 等待宽限期，期间出现 m3u8 优先', () async {
      final factory = FakeProbeFactory();
      final resolver = VideoResolver(probeFactory: factory.call, fileGrace: const Duration(milliseconds: 50));
      final future = resolver.resolve(_pageSource());
      await _settle();
      final probe = factory.probes.single;
      probe.emit(const MediaCandidate(url: 'https://ad.example/preroll.mp4', kind: MediaCandidateKind.file));
      probe.emit(const MediaCandidate(url: _signedHls, kind: MediaCandidateKind.hls));
      expect((await future).url, _signedHls);
    });

    test('只有 mp4 时宽限期后返回', () async {
      final factory = FakeProbeFactory();
      final resolver = VideoResolver(probeFactory: factory.call, fileGrace: const Duration(milliseconds: 20));
      final future = resolver.resolve(_pageSource());
      await _settle();
      factory.probes.single.emit(const MediaCandidate(
        url: 'https://cdn.example/ep1.mp4?token=x', kind: MediaCandidateKind.file, referer: 'https://player.example/'));
      final result = await future;
      expect(result.url, 'https://cdn.example/ep1.mp4?token=x');
      expect(result.headers['Referer'], 'https://player.example/');
    });

    test('iframe 嵌入地址递归解析并以 iframe 为 Referer', () async {
      final factory = FakeProbeFactory();
      final resolver = VideoResolver(probeFactory: factory.call);
      final future = resolver.resolve(_pageSource());
      await _settle();
      final iframe = 'https://player.example/jx/?url=${Uri.encodeComponent(_signedHls)}';
      factory.probes.single.emit(MediaCandidate(url: iframe, kind: MediaCandidateKind.iframe));
      final result = await future;
      expect(result.url, _signedHls);
      expect(result.headers['Referer'], iframe);
    });

    test('总超时报错并销毁', () async {
      final factory = FakeProbeFactory();
      final resolver = VideoResolver(probeFactory: factory.call, timeout: const Duration(milliseconds: 30));
      await expectLater(resolver.resolve(_pageSource()), _failsWith(VideoResolveFailure.timeout));
      await _settle();
      expect(factory.probes.single.disposeCount, 1);
      expect(resolver.activeProbes, 0);
    });

    test('取消后真正销毁且后续候选不再回调', () async {
      final factory = FakeProbeFactory();
      final resolver = VideoResolver(probeFactory: factory.call);
      final token = ResolveCancelToken();
      final future = resolver.resolve(_pageSource(), cancelToken: token);
      await _settle();
      token.cancel();
      await expectLater(future, _failsWith(VideoResolveFailure.cancelled));
      await _settle();
      final probe = factory.probes.single;
      expect(probe.disposeCount, 1);
      probe.emit(networkCandidate(_signedHls, const {}));
      expect(resolver.activeProbes, 0);
    });

    test('WebView 创建期间取消，创建完成后立即销毁', () async {
      final factory = FakeProbeFactory()..gate = Completer<void>();
      final resolver = VideoResolver(probeFactory: factory.call);
      final token = ResolveCancelToken();
      final future = resolver.resolve(_pageSource(), cancelToken: token);
      await _settle();
      expect(factory.calls, 1);
      token.cancel();
      await expectLater(future, _failsWith(VideoResolveFailure.cancelled));
      expect(resolver.activeProbes, 1);
      factory.gate!.complete();
      await _settle();
      expect(factory.probes.single.disposeCount, 1);
      expect(resolver.activeProbes, 0);
    });

    test('解析器启动失败归类为 probeFailed', () async {
      final factory = FakeProbeFactory()..error = StateError('no webview');
      final resolver = VideoResolver(probeFactory: factory.call);
      await expectLater(resolver.resolve(_pageSource()), _failsWith(VideoResolveFailure.probeFailed));
      await _settle();
      expect(resolver.activeProbes, 0);
    });

    test('并发 WebView 数量受上限约束，释放后排队者启动', () async {
      final factory = FakeProbeFactory();
      final resolver = VideoResolver(probeFactory: factory.call, maxConcurrentProbes: 2);
      final first = resolver.resolve(_pageSource());
      final second = resolver.resolve(_pageSource());
      final queuedToken = ResolveCancelToken();
      final queued = resolver.resolve(_pageSource(), cancelToken: queuedToken);
      final fourth = resolver.resolve(_pageSource());
      await _settle();
      expect(factory.probes, hasLength(2));
      queuedToken.cancel();
      await expectLater(queued, _failsWith(VideoResolveFailure.cancelled));
      factory.probes[0].emit(networkCandidate(_signedHls, const {}));
      await first;
      await _settle();
      expect(factory.probes, hasLength(3));
      expect(factory.probes[0].disposeCount, 1);
      factory.probes[1].emit(networkCandidate(_signedHls, const {}));
      factory.probes[2].emit(networkCandidate(_signedHls, const {}));
      await Future.wait([second, fourth]);
      await _settle();
      expect(resolver.activeProbes, 0);
    });
  });

  group('VideoResolveSession', () {
    test('切集后旧解析结果不会返回，旧 WebView 被销毁', () async {
      final factory = FakeProbeFactory();
      final session = VideoResolveSession(VideoResolver(probeFactory: factory.call));
      final old = session.resolve(_pageSource());
      await _settle();
      final current = session.resolve(_pageSource());
      await expectLater(old, _failsWith(VideoResolveFailure.cancelled));
      await _settle();
      expect(factory.probes.first.disposeCount, 1);
      factory.probes.first.emit(networkCandidate('https://old.example/a.m3u8', const {}));
      factory.probes.last.emit(networkCandidate(_signedHls, const {}));
      expect((await current).url, _signedHls);
    });

    test('直链旧结果在切换后同样作废', () async {
      final session = VideoResolveSession(VideoResolver(probeFactory: FakeProbeFactory().call));
      final old = session.resolve(VideoSource(quality: '', url: 'https://a.example/1.mp4'));
      session.cancel();
      await expectLater(old, _failsWith(VideoResolveFailure.cancelled));
    });
  });
}
