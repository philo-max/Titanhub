import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import '../../media/providers/media_providers.dart';
import '../../media/models/media_models.dart';
import '../../tracking/sync_provider.dart';

class PlayerScreen extends ConsumerStatefulWidget {
  final String pluginId;
  final String mediaId;
  final String chapterId;

  const PlayerScreen({
    super.key,
    required this.pluginId,
    required this.mediaId,
    required this.chapterId,
  });

  @override
  ConsumerState<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends ConsumerState<PlayerScreen> {
  // MediaKit structures
  late final Player _player;
  late final VideoController _controller;

  // Stream subscriptions
  StreamSubscription? _positionSub;
  StreamSubscription? _durationSub;
  StreamSubscription? _playingSub;

  // Active status
  VideoSource? _activeSource;
  double _playbackSpeed = 1.0;
  bool _isPlaying = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;

  // Danmakus overlay
  final List<_ActiveDanmaku> _activeDanmakus = [];
  final Set<String> _shownDanmakuIds = {};
  Timer? _danmakuUpdateTimer;
  bool _danmakuEnabled = true;

  @override
  void initState() {
    super.initState();
    _player = Player();
    _controller = VideoController(_player);

    // Subscribe to Player updates
    _playingSub = _player.stream.playing.listen((playing) {
      if (mounted) {
        setState(() {
          _isPlaying = playing;
        });
        if (!playing) {
          // Save progress immediately on pause
          final totalSecs = _duration.inSeconds;
          final currentSecs = _position.inSeconds;
          final progressRatio = totalSecs > 0 ? currentSecs / totalSecs : 0.0;
          ref.read(syncServiceProvider).saveProgress(
            mediaId: widget.mediaId,
            pluginId: widget.pluginId,
            mediaType: 'anime',
            chapterNo: 1,
            chapterId: widget.chapterId,
            progress: progressRatio,
            status: 'watching',
          );
        }
      }
    });

    _positionSub = _player.stream.position.listen((pos) {
      if (mounted) {
        setState(() {
          _position = pos;
        });
        _checkAndTriggerDanmakus(pos.inMilliseconds / 1000.0);

        // Auto-save progress to SQLite database every 5 seconds
        final seconds = pos.inSeconds;
        if (seconds > 0 && seconds % 5 == 0) {
          final totalSecs = _duration.inSeconds;
          final progressRatio = totalSecs > 0 ? seconds / totalSecs : 0.0;
          ref.read(syncServiceProvider).saveProgress(
            mediaId: widget.mediaId,
            pluginId: widget.pluginId,
            mediaType: 'anime',
            chapterNo: 1,
            chapterId: widget.chapterId,
            progress: progressRatio,
            status: 'watching',
          );
        }
      }
    });

    _durationSub = _player.stream.duration.listen((dur) {
      if (mounted) {
        setState(() {
          _duration = dur;
        });
      }
    });

    // High performance ticker timer to slide danmakus
    _danmakuUpdateTimer = Timer.periodic(const Duration(milliseconds: 16), (timer) {
      if (mounted && _isPlaying && _danmakuEnabled) {
        setState(() {
          for (var i = _activeDanmakus.length - 1; i >= 0; i--) {
            final d = _activeDanmakus[i];
            d.xOffset -= 3.0; // Slide speed
            if (d.xOffset < -300) {
              _activeDanmakus.removeAt(i);
            }
          }
        });
      }
    });
  }

  @override
  void dispose() {
    _danmakuUpdateTimer?.cancel();
    _positionSub?.cancel();
    _durationSub?.cancel();
    _playingSub?.cancel();
    _player.dispose();
    super.dispose();
  }

  // Load and play selected quality stream
  void _loadSource(VideoSource source, bool resume) {
    final currentPos = _player.state.position;
    setState(() {
      _activeSource = source;
    });

    _player.open(Media(source.url)).then((_) {
      if (resume) {
        _player.seek(currentPos);
        _player.play();
      }
      _player.setRate(_playbackSpeed);
    });
  }

  // Trigger matching danmakus based on current playback time
  void _checkAndTriggerDanmakus(double currentTime) {
    if (!_danmakuEnabled) return;
    
    // Get all danmakus from provider
    final danmakusAsync = ref.read(mediaDanmakusProvider((
      pluginId: widget.pluginId,
      mediaId: widget.mediaId,
      chapterId: widget.chapterId
    )));

    danmakusAsync.whenData((list) {
      final newComments = list.where((c) =>
          c.time >= currentTime - 0.5 &&
          c.time <= currentTime &&
          !_shownDanmakuIds.contains(c.id));

      for (var comment in newComments) {
        _shownDanmakuIds.add(comment.id);
        
        // Setup random track lane
        final lane = _activeDanmakus.length % 6;
        final yOffset = 16.0 + lane * 30.0;
        
        _activeDanmakus.add(_ActiveDanmaku(
          comment: comment,
          xOffset: 500.0, // Start from right boundary
          yOffset: yOffset,
        ));
      }
    });
  }

  String _formatDuration(Duration duration) {
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  Color _parseHexColor(String hex) {
    try {
      final buffer = StringBuffer();
      if (hex.length == 7) buffer.write('ff');
      buffer.write(hex.replaceFirst('#', ''));
      return Color(int.parse(buffer.toString(), radix: 16));
    } catch (_) {
      return Colors.white;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Watch providers
    final sourcesAsync = ref.watch(mediaVideoSourcesProvider((
      pluginId: widget.pluginId,
      chapterId: widget.chapterId
    )));
    final chaptersAsync = ref.watch(mediaChaptersProvider((
      pluginId: widget.pluginId,
      mediaId: widget.mediaId
    )));

    // Auto initialize active source once loaded
    ref.listen(mediaVideoSourcesProvider((
      pluginId: widget.pluginId,
      chapterId: widget.chapterId
    )), (prev, next) {
      next.whenData((sources) {
        if (_activeSource == null && sources.isNotEmpty) {
          _loadSource(sources[0], false);
        }
      });
    });

    return Scaffold(
      backgroundColor: Colors.black,
      body: sourcesAsync.when(
        data: (sources) {
          if (sources.isEmpty) {
            return _buildErrorView('未解析出可用的视频播放源。');
          }

          return SafeArea(
            child: Stack(
              children: [
                // 1. Native Video Player Screen
                Center(
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: Video(controller: _controller),
                  ),
                ),

                // 2. High Performance Flying Danmakus Canvas Overlay
                if (_danmakuEnabled)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: ClipRect(
                        child: LayoutBuilder(
                          builder: (context, constraints) {
                            return Stack(
                              children: _activeDanmakus.map((d) {
                                // Maps 0-500 reference width dynamically to screen width
                                final left = (d.xOffset / 500.0) * constraints.maxWidth;
                                return Positioned(
                                  left: left,
                                  top: d.yOffset,
                                  child: Text(
                                    d.comment.text,
                                    style: TextStyle(
                                      color: _parseHexColor(d.comment.color),
                                      fontSize: 14,
                                      fontWeight: FontWeight.bold,
                                      shadows: const [
                                        Shadow(
                                          blurRadius: 3.0,
                                          color: Colors.black,
                                          offset: Offset(1.0, 1.0),
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              }).toList(),
                            );
                          },
                        ),
                      ),
                    ),
                  ),

                // 3. Custom Controller Overlays
                Positioned.fill(
                  child: _buildControls(context, sources, chaptersAsync.value ?? []),
                ),
              ],
            ),
          );
        },
        loading: () => const Center(
          child: CircularProgressIndicator(color: Colors.violetAccent),
        ),
        error: (err, _) => _buildErrorView('加载播放器失败: $err'),
      ),
    );
  }

  Widget _buildErrorView(String message) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(LucideIcons.alertTriangle, size: 48, color: Colors.roseAccent),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 16),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => context.pop(),
              child: const Text('返回'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildControls(
    BuildContext context,
    List<VideoSource> sources,
    List<Chapter> chapters,
  ) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        // Top Header bar
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Colors.black54, Colors.transparent],
            ),
          ),
          child: Row(
            children: [
              IconButton(
                icon: const Icon(LucideIcons.arrowLeft, color: Colors.white),
                onPressed: () => context.pop(),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  widget.chapterId,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 16,
                  ),
                ),
              ),
            ],
          ),
        ),

        // Bottom Controls Bar
        Container(
          padding: const EdgeInsets.all(16),
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.bottomCenter,
              end: Alignment.topCenter,
              colors: [Colors.black87, Colors.transparent],
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Progress Track Seekbar
              Row(
                children: [
                  Text(
                    _formatDuration(_position),
                    style: const TextStyle(color: Colors.slate, fontSize: 11),
                  ),
                  Expanded(
                    child: Slider(
                      activeColor: Colors.violetAccent,
                      inactiveColor: Colors.slate[800],
                      min: 0.0,
                      max: _duration.inMilliseconds.toDouble(),
                      value: _position.inMilliseconds.toDouble().clamp(
                            0.0,
                            _duration.inMilliseconds.toDouble(),
                          ),
                      onChanged: (val) {
                        _player.seek(Duration(milliseconds: val.toInt()));
                      },
                    ),
                  ),
                  Text(
                    _formatDuration(_duration),
                    style: const TextStyle(color: Colors.slate, fontSize: 11),
                  ),
                ],
              ),

              // Action Buttons Row
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      // Play/Pause
                      IconButton(
                        icon: Icon(
                          _isPlaying ? LucideIcons.pause : LucideIcons.play,
                          color: Colors.white,
                        ),
                        onPressed: () {
                          if (_isPlaying) {
                            _player.pause();
                          } else {
                            _player.play();
                          }
                        },
                      ),
                      const SizedBox(width: 8),

                      // Danmaku Toggle
                      IconButton(
                        icon: Icon(
                          _danmakuEnabled ? LucideIcons.messageSquare : LucideIcons.messageSquare,
                          color: _danmakuEnabled ? Colors.violetAccent : Colors.slate,
                        ),
                        onPressed: () {
                          setState(() {
                            _danmakuEnabled = !_danmakuEnabled;
                          });
                        },
                      ),
                    ],
                  ),

                  Row(
                    children: [
                      // Quality Selector
                      if (sources.length > 1)
                        PopupMenuButton<VideoSource>(
                          initialValue: _activeSource,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: Colors.white10,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              _activeSource?.quality ?? '画质',
                              style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                            ),
                          ),
                          onSelected: (src) => _loadSource(src, true),
                          itemBuilder: (context) => sources.map((s) {
                            return PopupMenuItem<VideoSource>(
                              value: s,
                              child: Text(s.quality, style: const TextStyle(fontSize: 12)),
                            );
                          }).toList(),
                        ),
                      const SizedBox(width: 12),

                      // Playback Speed Selector
                      PopupMenuButton<double>(
                        initialValue: _playbackSpeed,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: Colors.white10,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            _playbackSpeed == 1.0 ? '倍速' : '${_playbackSpeed}x',
                            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                          ),
                        ),
                        onSelected: (speed) {
                          _player.setRate(speed);
                          setState(() {
                            _playbackSpeed = speed;
                          });
                        },
                        itemBuilder: (context) => [0.5, 1.0, 1.25, 1.5, 2.0, 3.0].map((speed) {
                          return PopupMenuItem<double>(
                            value: speed,
                            child: Text(speed == 1.0 ? '正常' : '${speed}x', style: const TextStyle(fontSize: 12)),
                          );
                        }).toList(),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ActiveDanmaku {
  final DanmakuComment comment;
  double xOffset; // Reference horizontal offset
  final double yOffset; // Reference vertical offset

  _ActiveDanmaku({
    required this.comment,
    required this.xOffset,
    required this.yOffset,
  });
}
