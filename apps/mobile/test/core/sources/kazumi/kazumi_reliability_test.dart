import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_rule.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_source.dart';

import 'kazumi_test_support.dart';

const List<Duration> _noDelay = [Duration.zero, Duration.zero];

KazumiSource build(
  FakeAdapter adapter, {
  DateTime Function()? clock,
  int pageCacheMaxEntries = 30,
  List<Duration> retryDelays = _noDelay,
}) {
  return KazumiSource(
    KazumiRule.fromJson(bundledRuleJson('ezdmw')),
    dio: fakeDio((o) => throw 1, adapter: adapter),
    clock: clock,
    pageCacheMaxEntries: pageCacheMaxEntries,
    retryDelays: retryDelays,
  );
}

DioException dioError(RequestOptions o, DioExceptionType type) => DioException(requestOptions: o, type: type);

void main() {
  final mediaId = Uri.encodeComponent('/Index/detail/12.html');

  group('详情页请求合并与缓存', () {
    test('getDetail 与 getChapters 只请求一次页面', () async {
      final adapter = FakeAdapter((o) => FakeReply(fixture('ezdmw_detail.html')));
      final source = build(adapter);
      final detail = source.getDetail(mediaId);
      final chapters = source.getChapters(mediaId);
      expect((await detail)['title'], '葬送的芙莉莲');
      expect(await chapters, isNotEmpty);
      await source.getDetail(mediaId);
      expect(adapter.calls, hasLength(1));
    });

    test('超过 2 分钟后重新请求', () async {
      var now = DateTime.utc(2024);
      final adapter = FakeAdapter((o) => FakeReply(fixture('ezdmw_detail.html')));
      final source = build(adapter, clock: () => now);
      await source.getDetail(mediaId);
      now = now.add(const Duration(minutes: 1, seconds: 59));
      await source.getChapters(mediaId);
      expect(adapter.calls, hasLength(1));
      now = now.add(const Duration(seconds: 2));
      await source.getChapters(mediaId);
      expect(adapter.calls, hasLength(2));
    });

    test('失败不缓存', () async {
      var failing = true;
      final adapter = FakeAdapter((o) => failing ? const FakeReply('x', status: 404) : FakeReply(fixture('ezdmw_detail.html')));
      final source = build(adapter);
      await expectLater(source.getDetail(mediaId), throwsA(isA<KazumiSourceException>()));
      failing = false;
      final detail = await source.getDetail(mediaId);
      expect(detail['title'], '葬送的芙莉莲');
      expect(adapter.calls, hasLength(2));
    });

    test('条目数超过上限时淘汰最早的', () async {
      final adapter = FakeAdapter((o) => FakeReply(fixture('ezdmw_detail.html')));
      final source = build(adapter, pageCacheMaxEntries: 2);
      String id(int n) => Uri.encodeComponent('/Index/detail/$n.html');
      for (final n in [1, 2, 3]) {
        await source.getDetail(id(n));
      }
      expect(adapter.calls, hasLength(3));
      await source.getDetail(id(3));
      await source.getDetail(id(2));
      expect(adapter.calls, hasLength(3));
      await source.getDetail(id(1));
      expect(adapter.calls, hasLength(4));
    });
  });

  group('请求重试', () {
    test('超时先失败两次后第三次成功', () async {
      var count = 0;
      final adapter = FakeAdapter((o) {
        count += 1;
        if (count < 3) return FakeReply('', error: dioError(o, DioExceptionType.connectionTimeout));
        return FakeReply(fixture('ezdmw_detail.html'));
      });
      final detail = await build(adapter).getDetail(mediaId);
      expect(detail['title'], '葬送的芙莉莲');
      expect(adapter.calls, hasLength(3));
    });

    test('连接错误、5xx、429 都最多重试 2 次共 3 次请求', () async {
      final replies = <String, FakeReply Function(RequestOptions)>{
        'connectionError': (o) => FakeReply('', error: dioError(o, DioExceptionType.connectionError)),
        '503': (_) => const FakeReply('x', status: 503),
        '429': (_) => const FakeReply('x', status: 429),
      };
      for (final entry in replies.entries) {
        final adapter = FakeAdapter(entry.value);
        await expectLater(build(adapter).getDetail(mediaId), throwsA(isA<KazumiSourceException>()), reason: entry.key);
        expect(adapter.calls, hasLength(3), reason: entry.key);
      }
    });

    test('4xx（非 429）不重试', () async {
      for (final status in [400, 401, 403, 404]) {
        final adapter = FakeAdapter((o) => FakeReply('x', status: status));
        await expectLater(build(adapter).getDetail(mediaId), throwsA(isA<KazumiSourceException>()), reason: '$status');
        expect(adapter.calls, hasLength(1), reason: '$status');
      }
    });

    test('退避间隔按给定序列等待', () async {
      final adapter = FakeAdapter((o) => FakeReply('', error: dioError(o, DioExceptionType.receiveTimeout)));
      final watch = Stopwatch()..start();
      await expectLater(
        build(adapter, retryDelays: const [Duration(milliseconds: 120), Duration(milliseconds: 240)]).getDetail(mediaId),
        throwsA(isA<KazumiSourceException>()),
      );
      expect(watch.elapsedMilliseconds, greaterThanOrEqualTo(340));
    });

    test('默认退避为 600ms、1500ms', () {
      expect(KazumiSource.defaultRetryDelays, const [Duration(milliseconds: 600), Duration(milliseconds: 1500)]);
    });
  });

  group('超时错误文案', () {
    test('分别写明连接超时、发送超时、接收超时，带主机与耗时秒数', () async {
      final types = {
        DioExceptionType.connectionTimeout: '连接超时',
        DioExceptionType.sendTimeout: '发送超时',
        DioExceptionType.receiveTimeout: '接收超时',
      };
      for (final entry in types.entries) {
        final adapter = FakeAdapter((o) => FakeReply('', error: dioError(o, entry.key)));
        Object? error;
        try {
          await build(adapter).getDetail(mediaId);
        } catch (e) {
          error = e;
        }
        final message = (error as KazumiSourceException).message;
        expect(message, contains(entry.value));
        expect(message, contains('m.ezdmw.org'));
        expect(message, matches(RegExp(r'耗时 \d+(\.\d+)? 秒')));
      }
    });
  });
}
