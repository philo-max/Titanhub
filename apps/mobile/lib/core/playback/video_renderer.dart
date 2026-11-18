import 'package:media_kit_video/media_kit_video.dart';

/// Android 视频输出模式。
///
/// 默认走 mpv 的 `vo=gpu`（GLES 渲染，支持缩放/色彩处理）。部分设备/模拟器上
/// mpv 拿不到 GLES 2 上下文（日志 `Could not create a GL context`，EGL_BAD_ATTRIBUTE），
/// 此时声音和时间轴照常走但画面全黑。`mediacodec_embed` 让 MediaCodec 直接解码到
/// Surface，完全不经过 mpv 的 EGL 路径，是 Kazumi 在同类问题上提供的同款回退。
enum VideoRendererMode { gpu, mediacodecEmbed }

/// 进程内的渲染模式记忆：一旦确认当前设备 GPU 上下文不可用，后续播放器直接用回退，
/// 避免每集都先黑屏再切换。不落盘——驱动/系统更新后下次启动会重新探测一次，代价仅一次重开。
class VideoRendererPreference {
  VideoRendererPreference._();

  static VideoRendererMode _mode = VideoRendererMode.gpu;

  static VideoRendererMode get mode => _mode;

  static void setMode(VideoRendererMode mode) => _mode = mode;

  static void markGpuUnavailable() => _mode = VideoRendererMode.mediacodecEmbed;

  /// 仅供测试恢复初始状态。
  static void resetForTest() => _mode = VideoRendererMode.gpu;
}

VideoControllerConfiguration videoControllerConfigurationFor(VideoRendererMode mode) {
  switch (mode) {
    case VideoRendererMode.gpu:
      // 保持 media_kit 平台默认（Android: vo=gpu, hwdec=auto-safe）。
      return const VideoControllerConfiguration();
    case VideoRendererMode.mediacodecEmbed:
      return const VideoControllerConfiguration(
        vo: 'mediacodec_embed',
        hwdec: 'mediacodec',
        enableHardwareAcceleration: true,
      );
  }
}

/// mpv 的 vo/gpu 在放弃所有 GPU 上下文时会输出这些 error 级日志。
/// 只匹配“彻底失败”的终态信息，单次 GLES 版本尝试失败不算（mpv 还会继续尝试其它版本）。
const List<String> _gpuContextFailureMarkers = [
  'Failed initializing any suitable GPU context',
  'Could not create a GL context',
];

bool isGpuContextFailureLog({required String prefix, required String text}) {
  if (!prefix.startsWith('vo')) return false;
  return _gpuContextFailureMarkers.any(text.contains);
}
