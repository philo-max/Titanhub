import 'package:flutter_inappwebview_platform_interface/flutter_inappwebview_platform_interface.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/playback/video_resolver.dart';
import 'package:titanhub/core/playback/webview_page_probe.dart';

void main() {
  group('嗅探设置', () {
    test('允许 https 页面加载 http 媒体（混合内容放行）', () {
      final settings = buildProbeSettings(const PageProbeRequest(pageUrl: 'https://a.example/p'));
      expect(settings.mixedContentMode, MixedContentMode.MIXED_CONTENT_ALWAYS_ALLOW);
      expect(settings.javaScriptEnabled, isTrue);
      expect(settings.blockNetworkImage, isTrue);
    });

    test('沿用请求头里的 User-Agent', () {
      final settings = buildProbeSettings(
        const PageProbeRequest(pageUrl: 'https://a.example/p', headers: {'user-agent': 'UA/1'}),
      );
      expect(settings.userAgent, 'UA/1');
    });
  });

  group('Range 请求识别无扩展名 mp4', () {
    test('带 Range: bytes= 的无扩展名请求被当作文件候选', () {
      final candidate = networkCandidate('https://cdn.example/stream/abc123', {'Range': 'bytes=0-'});
      expect(candidate.kind, MediaCandidateKind.file);
      expect(classifyMediaUrl(candidate.url, hint: candidate.kind), MediaCandidateKind.file);
    });

    test('请求头名大小写不敏感', () {
      expect(networkCandidate('https://cdn.example/v/1', {'range': 'bytes=100-'}).kind, MediaCandidateKind.file);
    });

    test('没有 Range 头的无扩展名请求不是候选', () {
      final candidate = networkCandidate('https://cdn.example/stream/abc123', {'Referer': 'https://a.example/'});
      expect(candidate.kind, isNull);
      expect(classifyMediaUrl(candidate.url, hint: candidate.kind), isNull);
    });

    test('静态资源与分片即使带 Range 也不算', () {
      for (final url in [
        'https://cdn.example/a.js',
        'https://cdn.example/a.css',
        'https://cdn.example/a.png?x=1',
        'https://cdn.example/a.woff2',
        'https://cdn.example/seg1.ts',
        'https://cdn.example/seg1.m4s',
      ]) {
        final candidate = networkCandidate(url, {'Range': 'bytes=0-'});
        expect(classifyMediaUrl(candidate.url, hint: candidate.kind), isNull, reason: url);
      }
    });

    test('广告域名带 Range 仍被过滤', () {
      final candidate = networkCandidate('https://googleads.g.doubleclick.net/v', {'Range': 'bytes=0-'});
      expect(classifyMediaUrl(candidate.url, hint: candidate.kind), isNull);
    });

    test('m3u8 路径带 Range 仍判为 hls', () {
      final candidate = networkCandidate('https://cdn.example/a.m3u8', {'Range': 'bytes=0-'});
      expect(classifyMediaUrl(candidate.url, hint: candidate.kind), MediaCandidateKind.hls);
    });

    test('非 bytes 的 Range 头不算', () {
      expect(networkCandidate('https://cdn.example/v/1', {'Range': 'items=0-1'}).kind, isNull);
    });
  });
}
