import 'dart:async';

import 'package:flutter/foundation.dart';

const int mpvDemuxerBufferBytes = 150 * 1024 * 1024;
const int _mpvDemuxerBackBufferBytes = 32 * 1024 * 1024;
const Duration _mpvPropertyTimeout = Duration(seconds: 10);

const Map<String, String> mpvNetworkProperties = {
  'demuxer-max-back-bytes': '$_mpvDemuxerBackBufferBytes',
  'cache-secs': '120',
  'stream-lavf-o': 'reconnect=1,reconnect_streamed=1,reconnect_delay_max=5',
};

void _logMpvPropertyFailure(String property, Object error) {
  debugPrint('mpv 属性 $property 设置失败：$error');
}

Future<void> applyMpvNetworkProperties(
  Future<void> Function(String property, String value) setProperty, {
  Duration perPropertyTimeout = _mpvPropertyTimeout,
  void Function(String property, Object error) onError = _logMpvPropertyFailure,
}) async {
  for (final entry in mpvNetworkProperties.entries) {
    try {
      await setProperty(entry.key, entry.value).timeout(perPropertyTimeout);
    } catch (error) {
      onError(entry.key, error);
    }
  }
}
