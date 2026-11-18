import 'dart:async';
import '../../../core/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
import '../../../core/identity/media_identity.dart';
import '../../../core/playback/chapter_groups.dart';
import '../../../core/playback/mpv_tuning.dart';
import '../../../core/playback/resume_target.dart';
import '../../../core/playback/video_renderer.dart';
import '../../../core/router/app_router.dart';
import '../../../core/sources/local_sources.dart';
import '../../media/providers/media_providers.dart';
import '../../media/models/media_models.dart';
import '../../media/widgets/episode_selector.dart';
import '../../tracking/sync_provider.dart';

const Object playerFullscreenExtra = #playerFullscreen;
const Duration _errorRecoveryWindow = Duration(seconds: 3);
const String _networkTimeoutProperty = 'network-timeout';
const String _networkTimeoutSeconds = '20';
const Duration _networkTimeoutSetupLimit = Duration(seconds: 10);

class PlayerScreen extends ConsumerStatefulWidget {
  final String pluginId;
  final String mediaId;
  final String chapterId;
  final String? groupId;
  final bool startFullscreen;

  const PlayerScreen({
    super.key,
    required this.pluginId,
    required this.mediaId,
    required this.chapterId,
    this.groupId,
    this.startFullscreen = false,
  });

  @override
  ConsumerState<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends ConsumerState<PlayerScreen> with WidgetsBindingObserver {
  // MediaKit structures
  late final Player _player;
  late final VideoController _controller;

  // Stream subscriptions
  StreamSubscription? _positionSub;
  StreamSubscription? _durationSub;
  StreamSubscription? _playingSub;
  StreamSubscription? _completedSub;
  StreamSubscription? _errorSub;
  StreamSubscription? _logSub;
  ProviderSubscription<AsyncValue<List<VideoSource>>>? _sourcesSub;

  // Active status
  VideoSource? _activeSource;
  double _playbackSpeed = 1.0;
  bool _isPlaying = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  Duration? _dragPosition;

  late final String _mediaType;
  late final SyncService _syncService;
  int _chapterNo = 0;
  String? _chapterTitle;
  int? _savedPositionMs;
  int? _savedDurationEstimateMs;
  bool _resumeApplied = false;
  int _lastSavedSecond = -1;
  bool _disposed = false;

  List<Chapter>? _chapterSource;
  List<ChapterLine> _lines = const [];
  ChapterLocation? _location;
  Widget? _episodeSelector;

  bool _opening = false;
  int _openGeneration = 0;
  bool _advancing = false;
  bool _reachedLineEnd = false;
  String? _playbackError;
  Duration _errorPosition = Duration.zero;
  String? _preferredQuality;
  Duration? _retryPosition;
  bool _controlsVisible = true;
  bool _fullscreen = false;
  bool _handingOffFullscreen = false;
  late final VideoRendererMode _rendererMode;
  bool _rendererFallbackStarted = false;

  // Danmakus overlay
  final List<_ActiveDanmaku> _activeDanmakus = [];
  final Set<String> _shownDanmakuIds = {};
  Timer? _danmakuUpdateTimer;
  bool _danmakuEnabled = true;

  MediaIdentity get _identity => MediaIdentity(
        pluginId: widget.pluginId,
        mediaType: _mediaType,
        mediaId: widget.mediaId,
      );

  @override
  void initState() {
    super.initState();
    _syncService = ref.read(syncServiceProvider);
    WidgetsBinding.instance.addObserver(this);
    _mediaType = resolveMediaType(
      types: ref.read(sourceByIdProvider(widget.pluginId))?.types,
      mediaId: widget.mediaId,
    );
    _player = Player(
      configuration: const PlayerConfiguration(
        bufferSize: mpvDemuxerBufferBytes,
        logLevel: MPVLogLevel.warn,
      ),
    );
    _rendererMode = VideoRendererPreference.mode;
    _controller = VideoController(
      _player,
      configuration: videoControllerConfigurationFor(_rendererMode),
    );
    // GPU 上下文建不起来时 mpv 只会写 error 日志、不会抛 player.error，
    // 画面黑但时间轴照走——必须从日志里抓。
    _logSub = _player.stream.log.listen((log) {
      if (_rendererMode != VideoRendererMode.gpu) return;
      if (isGpuContextFailureLog(prefix: log.prefix, text: log.text)) _fallbackToMediaCodec();
    });
    _restoreSavedPosition();
    if (widget.startFullscreen) {
      _fullscreen = true;
      _applySystemUi(fullscreen: true);
    }

    _sourcesSub = ref.listenManual(mediaVideoSourcesProvider(_sourcesArg), (_, next) => _onSources(next));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _onSources(ref.read(mediaVideoSourcesProvider(_sourcesArg)));
    });

    // Subscribe to Player updates
    _playingSub = _player.stream.playing.listen((playing) {
      if (!mounted) return;
      setState(() {
        _isPlaying = playing;
      });
      if (!playing) {
        _saveProgress();
      }
    });

    _completedSub = _player.stream.completed.listen((completed) {
      if (completed && mounted) _onCompleted();
    });

    _errorSub = _player.stream.error.listen((message) {
      if (!mounted || message.isEmpty) return;
      setState(() {
        _playbackError = message;
        _errorPosition = _position;
        _opening = false;
      });
    });

    _positionSub = _player.stream.position.listen((pos) {
      if (!mounted) return;
      setState(() {
        _position = pos;
        if (pos > Duration.zero) _opening = false;
        if (_playbackError != null && pos > _errorPosition + _errorRecoveryWindow) {
          _playbackError = null;
        }
      });
      if (!_resumeApplied && _savedPositionMs != null) _applyResumeIfReady();
      _checkAndTriggerDanmakus(pos.inMilliseconds / 1000.0);

      final seconds = pos.inSeconds;
      if (seconds > 0 && seconds % 5 == 0 && seconds != _lastSavedSecond) {
        _lastSavedSecond = seconds;
        _saveProgress();
      }
    });

    _durationSub = _player.stream.duration.listen((dur) {
      if (!mounted) return;
      setState(() {
        _duration = dur;
      });
      if (_savedPositionMs != null && !_resumeApplied) {
        _applyResumeIfReady();
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

  Future<void> _restoreSavedPosition() async {
    final saved = await ref.read(syncServiceProvider).loadProgress(_identity);
    if (!mounted || saved == null) return;
    if (!isSameChapter(saved.chapterId, widget.chapterId)) return;
    if (_location == null) {
      setState(() {
        _chapterNo = saved.chapterNo;
        _chapterTitle = saved.chapterTitle;
      });
    }
    _savedPositionMs = saved.position;
    final savedPosition = saved.position;
    if (savedPosition != null && saved.progress > 0) {
      _savedDurationEstimateMs = (savedPosition / saved.progress).round();
    }
    _applyResumeIfReady();
  }

  void _applyResumeIfReady() {
    if (_resumeApplied || _opening || _activeSource == null) return;
    final durationMs = _duration.inMilliseconds;
    if (durationMs <= 0) return;
    _resumeApplied = true;
    final resumeMs = restoredVideoPositionMs(savedMs: _savedPositionMs, durationMs: durationMs);
    if (resumeMs != null) _player.seek(Duration(milliseconds: resumeMs));
  }

  Duration? _takeInitialStart() {
    final retry = _retryPosition;
    _retryPosition = null;
    if (retry != null && retry > Duration.zero) return retry;
    if (_resumeApplied || _savedPositionMs == null) return null;
    _resumeApplied = true;
    final resumeMs = restoredVideoPositionMs(
      savedMs: _savedPositionMs,
      durationMs: _savedDurationEstimateMs,
    );
    return resumeMs == null ? null : Duration(milliseconds: resumeMs);
  }

  ({String pluginId, String chapterId}) get _sourcesArg =>
      (pluginId: widget.pluginId, chapterId: widget.chapterId);

  void _applyChapters(List<Chapter> chapters) {
    _chapterSource = chapters;
    _lines = groupChapterLines(chapters);
    _location = locateChapter(_lines, widget.chapterId, groupId: widget.groupId);
    final location = _location;
    if (location != null) {
      _chapterNo = chapterNoAt(_lines, location);
      _chapterTitle = _lines[location.line].chapters[location.index].title;
    }
    _episodeSelector = EpisodeSelector(
      lines: _lines,
      activeChapterId: widget.chapterId,
      activeGroupId: location != null ? _lines[location.line].id : widget.groupId,
      onSelect: (chapter, line) => _goToChapter(chapter, line.id),
    );
  }

  String? get _currentLineId => _location != null ? _lines[_location!.line].id : widget.groupId;

  void _onSources(AsyncValue<List<VideoSource>> value) {
    final sources = value.valueOrNull;
    if (_disposed || _activeSource != null || sources == null || sources.isEmpty) return;
    final preferred = sources.where((source) => source.quality == _preferredQuality);
    _loadSource(preferred.isNotEmpty ? preferred.first : sources.first, start: _takeInitialStart());
  }

  void _onCompleted() {
    if (_advancing || _opening || _playbackError != null) return;
    final state = _player.state;
    if (!reachedNaturalEnd(position: state.position, duration: state.duration)) return;
    _saveProgress();
    final next = nextInLine(_lines, widget.chapterId, groupId: _currentLineId);
    if (next == null) {
      setState(() => _reachedLineEnd = _location != null);
      return;
    }
    _goToChapter(next, _currentLineId ?? '');
  }

  void _goToChapter(Chapter chapter, String lineId) {
    if (_advancing || _disposed) return;
    if (chapter.id == widget.chapterId && lineId == (_currentLineId ?? '')) return;
    _advancing = true;
    _saveProgress();
    _handingOffFullscreen = _fullscreen;
    context.pushReplacement(
      playLocation(
        pluginId: widget.pluginId,
        mediaId: widget.mediaId,
        chapterId: chapter.id,
        groupId: lineId,
      ),
      extra: _fullscreen ? playerFullscreenExtra : null,
    );
  }

  /// vo 只能在 VideoController 创建时确定，原地换不了；记住偏好后用同一路由重建播放页。
  /// 自动回退只触发一次，回退后的页面 _rendererMode 已不是 gpu，不会再进来，杜绝循环重开。
  void _fallbackToMediaCodec() {
    if (_rendererFallbackStarted || _disposed || !mounted) return;
    _switchRendererMode(VideoRendererMode.mediacodecEmbed);
  }

  void _switchRendererMode(VideoRendererMode nextMode) {
    if (_rendererFallbackStarted || _disposed || !mounted || nextMode == _rendererMode) return;
    _rendererFallbackStarted = true;
    VideoRendererPreference.setMode(nextMode);
    _saveProgress(force: true);
    _handingOffFullscreen = _fullscreen;
    context.pushReplacement(
      playLocation(
        pluginId: widget.pluginId,
        mediaId: widget.mediaId,
        chapterId: widget.chapterId,
        groupId: _currentLineId,
      ),
      extra: _fullscreen ? playerFullscreenExtra : null,
    );
  }

  void _retry() {
    _preferredQuality = _activeSource?.quality ?? _preferredQuality;
    _retryPosition = _player.state.position;
    if (_retryPosition! <= Duration.zero) _resumeApplied = false;
    setState(() {
      _playbackError = null;
      _activeSource = null;
      _opening = false;
      _reachedLineEnd = false;
    });
    ref.invalidate(mediaVideoSourcesProvider(_sourcesArg));
  }

  void _setFullscreen(bool value) {
    setState(() => _fullscreen = value);
    _applySystemUi(fullscreen: value);
  }

  Future<void> _applySystemUi({required bool fullscreen}) async {
    if (fullscreen) {
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
      await SystemChrome.setPreferredOrientations(
        const [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight],
      );
    } else {
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
      await SystemChrome.setPreferredOrientations(const []);
    }
  }

  void _saveProgress({bool force = false}) {
    if (_disposed && !force) return;
    if (_opening) return;
    final totalMs = _duration.inMilliseconds;
    final currentMs = _position.inMilliseconds;
    if (totalMs <= 0 && currentMs <= 0) return;
    if (currentMs <= 0 && _savedPositionMs != null && !_resumeApplied) return;
    final ratio = totalMs > 0 ? currentMs / totalMs : 0.0;
    try {
      _syncService.saveProgress(
            pluginId: widget.pluginId,
            mediaType: _mediaType,
            mediaId: widget.mediaId,
            chapterNo: _chapterNo,
            chapterId: widget.chapterId,
            chapterTitle: _chapterTitle,
            progress: ratio,
            position: currentMs,
          );
    } catch (_) {}
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      _saveProgress();
    }
  }

  @override
  void dispose() {
    _saveProgress(force: true);
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _danmakuUpdateTimer?.cancel();
    _positionSub?.cancel();
    _durationSub?.cancel();
    _playingSub?.cancel();
    _completedSub?.cancel();
    _errorSub?.cancel();
    _logSub?.cancel();
    _sourcesSub?.close();
    if (_fullscreen && !_handingOffFullscreen) _applySystemUi(fullscreen: false);
    _player.dispose();
    super.dispose();
  }

  void _loadSource(VideoSource source, {Duration? start, bool play = true}) {
    final generation = ++_openGeneration;
    setState(() {
      _activeSource = source;
      _playbackError = null;
      _opening = true;
    });
    _openMedia(
      Media(source.url, httpHeaders: source.headers, start: start),
      play: play,
      generation: generation,
    ).then((_) {
      if (_disposed || generation != _openGeneration) return;
      _player.setRate(_playbackSpeed);
      if (!play) setState(() => _opening = false);
    }).catchError((Object error) {
      if (!mounted || generation != _openGeneration) return;
      setState(() {
        _playbackError = '$error';
        _opening = false;
      });
    });
  }

  Future<void> _openMedia(Media media, {required bool play, required int generation}) async {
    final platform = _player.platform;
    if (platform is NativePlayer) {
      await platform
          .setProperty(_networkTimeoutProperty, _networkTimeoutSeconds)
          .timeout(_networkTimeoutSetupLimit);
      await applyMpvNetworkProperties(platform.setProperty);
    }
    if (_disposed || generation != _openGeneration) return;
    await _player.open(media, play: play);
  }

  void _switchQuality(VideoSource source) {
    if (identical(source, _activeSource)) return;
    final state = _player.state;
    _preferredQuality = source.quality;
    _loadSource(source, start: state.position, play: state.playing);
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
    final sourcesAsync = ref.watch(mediaVideoSourcesProvider(_sourcesArg));
    final chaptersAsync = ref.watch(mediaChaptersProvider((
      pluginId: widget.pluginId,
      mediaId: widget.mediaId
    )));
    final chapters = chaptersAsync.valueOrNull;
    if (chapters != null && !identical(chapters, _chapterSource)) {
      _applyChapters(chapters);
    }

    final player = _buildPlayer(context, sourcesAsync);
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        if (_fullscreen) {
          _setFullscreen(false);
          return;
        }
        _saveProgress();
        if (context.canPop()) {
          context.pop();
        }
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: _fullscreen
            ? player
            : SafeArea(
                child: Column(
                  children: [
                    AspectRatio(aspectRatio: 16 / 9, child: player),
                    Expanded(child: _buildEpisodePanel(chaptersAsync)),
                  ],
                ),
              ),
      ),
    );
  }

  String? _sourceErrorMessage(AsyncValue<List<VideoSource>> sourcesAsync) {
    if (_playbackError != null) return '播放失败：$_playbackError';
    if (sourcesAsync.hasError && !sourcesAsync.isLoading) {
      return '解析播放地址失败：${sourcesAsync.error}';
    }
    final sources = sourcesAsync.valueOrNull;
    if (sources != null && sources.isEmpty && !sourcesAsync.isLoading) {
      return '未解析出可用的视频播放源。';
    }
    return null;
  }

  Widget _buildPlayer(BuildContext context, AsyncValue<List<VideoSource>> sourcesAsync) {
    final sources = sourcesAsync.valueOrNull ?? const <VideoSource>[];
    final errorMessage = _sourceErrorMessage(sourcesAsync);
    final loading = errorMessage == null && (_activeSource == null || _opening);
    return Container(
      color: Colors.black,
      child: Stack(
                children: [
                  Positioned.fill(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => setState(() => _controlsVisible = !_controlsVisible),
                      child: Video(controller: _controller, controls: NoVideoControls),
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

                  if (_controlsVisible)
                    Positioned.fill(
                      child: _buildControls(context, sources),
                    ),
                  if (loading)
                    const Center(
                      child: CircularProgressIndicator(color: AppTheme.primary),
                    ),
                  if (errorMessage != null)
                    Positioned.fill(child: _buildErrorView(errorMessage)),
                ],
      ),
    );
  }

  Widget _buildErrorView(String message) {
    return Container(
      color: Colors.black87,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(16),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(LucideIcons.triangleAlert, size: 32, color: AppTheme.danger),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.white, fontSize: 13),
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                ElevatedButton(
                  onPressed: _retry,
                  child: const Text('重试本集'),
                ),
                const SizedBox(width: 12),
                OutlinedButton(
                  onPressed: () => _fullscreen ? _setFullscreen(false) : context.pop(),
                  child: Text(_fullscreen ? '退出全屏' : '返回'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEpisodePanel(AsyncValue<List<Chapter>> chaptersAsync) {
    final next = nextInLine(_lines, widget.chapterId, groupId: _currentLineId);
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(LucideIcons.listVideo, color: AppTheme.primary, size: 18),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  '选集',
                  style: TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
                ),
              ),
              if (next != null)
                TextButton.icon(
                  onPressed: () => _goToChapter(next, _currentLineId ?? ''),
                  icon: const Icon(LucideIcons.skipForward, size: 16),
                  label: const Text('下一集'),
                ),
            ],
          ),
          if (_reachedLineEnd)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text('已是本线路最后一集', style: TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
            ),
          if (_location == null && _lines.isNotEmpty)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Text(
                '无法确定当前集所属线路，自动下一集已停用，请手动选集。',
                style: TextStyle(color: AppTheme.warning, fontSize: 12),
              ),
            ),
          const SizedBox(height: 8),
          chaptersAsync.when(
            data: (_) => _episodeSelector ?? const SizedBox.shrink(),
            loading: () => const Center(
              child: Padding(
                padding: EdgeInsets.all(16),
                child: CircularProgressIndicator(color: AppTheme.primary),
              ),
            ),
            error: (err, _) => Text('加载选集失败：$err', style: const TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
  }

  Widget _buildControls(
    BuildContext context,
    List<VideoSource> sources,
  ) {
    final next = nextInLine(_lines, widget.chapterId, groupId: _currentLineId);
    final dragged = _dragPosition ?? _position;
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
                tooltip: '返回',
                onPressed: () {
                  if (_fullscreen) {
                    _setFullscreen(false);
                    return;
                  }
                  _saveProgress();
                  context.pop();
                },
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _chapterTitle ?? widget.chapterId,
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
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
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
                    _formatDuration(dragged),
                    style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
                  ),
                  Expanded(
                    child: Slider(
                      activeColor: AppTheme.primary,
                      inactiveColor: AppTheme.surfaceLight,
                      min: 0.0,
                      max: _duration.inMilliseconds > 0
                          ? _duration.inMilliseconds.toDouble()
                          : 1.0,
                      value: _duration.inMilliseconds > 0
                          ? dragged.inMilliseconds.toDouble().clamp(
                                0.0,
                                _duration.inMilliseconds.toDouble(),
                              )
                          : 0.0,
                      onChanged: _duration.inMilliseconds > 0
                          ? (val) {
                              setState(() => _dragPosition = Duration(milliseconds: val.toInt()));
                            }
                          : null,
                      onChangeEnd: _duration.inMilliseconds > 0
                          ? (val) {
                              _player.seek(Duration(milliseconds: val.toInt()));
                              setState(() => _dragPosition = null);
                            }
                          : null,
                    ),
                  ),
                  Text(
                    _formatDuration(_duration),
                    style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11),
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
                      if (next != null)
                        IconButton(
                          icon: const Icon(LucideIcons.skipForward, color: Colors.white),
                          tooltip: '下一集',
                          onPressed: () => _goToChapter(next, _currentLineId ?? ''),
                        ),

                      // Danmaku Toggle
                      IconButton(
                        icon: Icon(
                          _danmakuEnabled ? LucideIcons.messageSquare : LucideIcons.messageSquare,
                          color: _danmakuEnabled ? AppTheme.primary : AppTheme.textSecondary,
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
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                            ),
                          ),
                          onSelected: _switchQuality,
                          itemBuilder: (context) => sources.map((s) {
                            return PopupMenuItem<VideoSource>(
                              value: s,
                              child: Text(s.quality, style: const TextStyle(fontSize: 12)),
                            );
                          }).toList(),
                        ),
                      const SizedBox(width: 12),

                      // Renderer Mode Selector (GPU vs MediaCodec Direct Surface)
                      PopupMenuButton<VideoRendererMode>(
                        initialValue: _rendererMode,
                        tooltip: '渲染输出模式（黑屏时可切换硬解）',
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: Colors.white10,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            _rendererMode == VideoRendererMode.gpu ? 'GPU' : '硬解',
                            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                          ),
                        ),
                        onSelected: _switchRendererMode,
                        itemBuilder: (context) => const [
                          PopupMenuItem<VideoRendererMode>(
                            value: VideoRendererMode.gpu,
                            child: Text('GPU 渲染 (默认)', style: TextStyle(fontSize: 12)),
                          ),
                          PopupMenuItem<VideoRendererMode>(
                            value: VideoRendererMode.mediacodecEmbed,
                            child: Text('MediaCodec 直出 (防黑屏)', style: TextStyle(fontSize: 12)),
                          ),
                        ],
                      ),
                      const SizedBox(width: 8),

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
                      IconButton(
                        icon: Icon(
                          _fullscreen ? LucideIcons.minimize : LucideIcons.maximize,
                          color: Colors.white,
                        ),
                        tooltip: _fullscreen ? '退出全屏' : '全屏',
                        onPressed: () => _setFullscreen(!_fullscreen),
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
