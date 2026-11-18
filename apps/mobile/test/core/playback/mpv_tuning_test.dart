import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/playback/mpv_tuning.dart';

void main() {
  group('mpv 网络缓冲与重连属性', () {
    test('缓冲大小适合手机，远小于官方的 1500MB', () {
      expect(mpvDemuxerBufferBytes, 150 * 1024 * 1024);
      expect(mpvDemuxerBufferBytes, lessThan(1500 * 1024 * 1024));
      expect(mpvNetworkProperties['demuxer-max-back-bytes'], '${32 * 1024 * 1024}');
    });

    test('包含 cache 秒数与 stream-lavf-o 重连参数', () {
      expect(mpvNetworkProperties['cache-secs'], '120');
      final lavf = mpvNetworkProperties['stream-lavf-o']!.split(',');
      expect(lavf, containsAll(['reconnect=1', 'reconnect_streamed=1', 'reconnect_delay_max=5']));
    });

    test('逐项应用到播放器', () async {
      final applied = <String, String>{};
      await applyMpvNetworkProperties((name, value) async => applied[name] = value);
      expect(applied, mpvNetworkProperties);
    });

    test('某项设置失败或超时被吞掉并记录，其余照常设置', () async {
      final applied = <String>[];
      final failures = <String>[];
      await applyMpvNetworkProperties(
        (name, value) async {
          if (name == 'stream-lavf-o') throw StateError('unsupported');
          if (name == 'cache-secs') await Future<void>.delayed(const Duration(seconds: 1));
          applied.add(name);
        },
        perPropertyTimeout: const Duration(milliseconds: 50),
        onError: (name, error) => failures.add(name),
      );
      expect(failures, unorderedEquals(['stream-lavf-o', 'cache-secs']));
      expect(applied, containsAll(['demuxer-max-back-bytes']));
      expect(applied, isNot(contains('stream-lavf-o')));
    });
  });
}
