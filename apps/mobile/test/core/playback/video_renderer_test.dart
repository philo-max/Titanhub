import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/playback/video_renderer.dart';

void main() {
  tearDown(VideoRendererPreference.resetForTest);

  group('GPU 上下文失败识别', () {
    test('识别 Android 模拟器真实 mpv 日志中的终态失败', () {
      // 摘自 .probe/nov01-timeout-native-runtime.log 的实际输出
      expect(
        isGpuContextFailureLog(prefix: 'vo/gpu/opengl', text: 'Could not create a GL context.'),
        isTrue,
      );
      expect(
        isGpuContextFailureLog(prefix: 'vo/gpu', text: 'Failed initializing any suitable GPU context!'),
        isTrue,
      );
    });

    test('单次 GLES 版本尝试失败与其它模块日志不触发回退', () {
      expect(
        isGpuContextFailureLog(prefix: 'vo/gpu/opengl', text: 'Could not create EGL context for GLES 2.x +!'),
        isFalse,
      );
      expect(
        isGpuContextFailureLog(prefix: 'ffmpeg', text: 'Could not create a GL context'),
        isFalse,
      );
      expect(isGpuContextFailureLog(prefix: 'vd', text: 'h264_mediacodec (h264)'), isFalse);
    });
  });

  group('渲染模式配置', () {
    test('默认 gpu 保留 media_kit 平台默认值', () {
      final config = videoControllerConfigurationFor(VideoRendererMode.gpu);
      expect(config.vo, isNull);
      expect(config.hwdec, isNull);
      expect(config.enableHardwareAcceleration, isTrue);
    });

    test('回退模式绕开 mpv EGL，直接 MediaCodec 解码到 Surface', () {
      final config = videoControllerConfigurationFor(VideoRendererMode.mediacodecEmbed);
      expect(config.vo, 'mediacodec_embed');
      expect(config.hwdec, 'mediacodec');
      expect(config.enableHardwareAcceleration, isTrue);
    });

    test('标记失败或手动切换后进程内后续播放器直接使用对应模式', () {
      expect(VideoRendererPreference.mode, VideoRendererMode.gpu);
      VideoRendererPreference.markGpuUnavailable();
      expect(VideoRendererPreference.mode, VideoRendererMode.mediacodecEmbed);
      VideoRendererPreference.setMode(VideoRendererMode.gpu);
      expect(VideoRendererPreference.mode, VideoRendererMode.gpu);
    });
  });
}
