import 'dart:async';
import 'dart:collection';

import '../../features/media/models/media_models.dart';

enum MediaCandidateKind { hls, file, iframe }

enum VideoResolveFailure { cancelled, timeout, unsupportedUrl, probeFailed }

class VideoResolveException implements Exception {
  const VideoResolveException(this.failure, this.message);

  final VideoResolveFailure failure;
  final String message;

  @override
  String toString() => 'VideoResolveException(${failure.name}): $message';
}

class MediaCandidate {
  const MediaCandidate({
    required this.url,
    this.kind,
    this.referer,
    this.userAgent,
    this.origin,
  });

  final String url;
  final MediaCandidateKind? kind;
  final String? referer;
  final String? userAgent;
  final String? origin;
}

class PageProbeRequest {
  const PageProbeRequest({required this.pageUrl, this.headers = const {}});

  final String pageUrl;
  final Map<String, String> headers;

  String? get userAgent => headerValue(headers, 'User-Agent');

  Map<String, String> get requestHeaders => {
        for (final entry in headers.entries)
          if (entry.key.toLowerCase() != 'user-agent') entry.key: entry.value,
      };
}

abstract class PageProbe {
  Future<void> dispose();
}

typedef PageProbeFactory = Future<PageProbe> Function(
  PageProbeRequest request,
  void Function(MediaCandidate candidate) onCandidate,
);

const _adHostFragments = ['googleads', 'googlesyndication', 'doubleclick', 'adtrafficquality'];
const _adUrlFragments = ['prestrain.html', 'prestrain%2ehtml'];
const _embeddedUrlParams = ['url', 'src', 'vid', 'v'];
const _allowedBlankPages = ['about:blank', 'about:srcdoc'];

String? headerValue(Map<String, String>? headers, String name) {
  if (headers == null) return null;
  final lower = name.toLowerCase();
  for (final entry in headers.entries) {
    if (entry.key.toLowerCase() == lower && entry.value.isNotEmpty) return entry.value;
  }
  return null;
}

Uri? parseWebUrl(String? raw) {
  if (raw == null) return null;
  final text = raw.trim();
  if (text.isEmpty) return null;
  final uri = Uri.tryParse(text);
  if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) return null;
  if (uri.host.isEmpty) return null;
  return uri;
}

bool isAllowedWebUrl(String? raw) => parseWebUrl(raw) != null;

bool isAllowedNavigation(String? raw) =>
    _allowedBlankPages.contains(raw) || isAllowedWebUrl(raw);

bool isAdUrl(Uri uri) {
  final host = uri.host.toLowerCase();
  if (_adHostFragments.any(host.contains)) return true;
  final full = uri.toString().toLowerCase();
  return _adUrlFragments.any(full.contains);
}

MediaCandidateKind? classifyMediaUrl(String raw, {MediaCandidateKind? hint}) {
  final uri = parseWebUrl(raw);
  if (uri == null || isAdUrl(uri)) return null;
  final path = uri.path.toLowerCase();
  if (path.endsWith('.m3u8')) return MediaCandidateKind.hls;
  if (path.endsWith('.mp4')) return MediaCandidateKind.file;
  if (hint == MediaCandidateKind.hls || hint == MediaCandidateKind.file) return hint;
  return null;
}

String? embeddedMediaUrl(String iframeSrc) {
  final uri = parseWebUrl(iframeSrc);
  if (uri == null || isAdUrl(uri)) return null;
  for (final key in _embeddedUrlParams) {
    final value = uri.queryParameters[key];
    if (value != null && classifyMediaUrl(value) != null) return value.trim();
  }
  return null;
}

final RegExp _staticAssetExtension = RegExp(
  r'\.(js|mjs|css|map|json|html?|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|ts|m4s|aac|m4a|vtt|srt|key)$',
  caseSensitive: false,
);

bool _isRangeMediaRequest(String url, Map<String, String>? requestHeaders) {
  final range = headerValue(requestHeaders, 'Range');
  if (range == null || !range.trim().toLowerCase().startsWith('bytes=')) return false;
  final uri = parseWebUrl(url);
  if (uri == null || isAdUrl(uri)) return false;
  return !_staticAssetExtension.hasMatch(uri.path);
}

MediaCandidate networkCandidate(String url, Map<String, String>? requestHeaders) {
  return MediaCandidate(
    url: url,
    kind: _isRangeMediaRequest(url, requestHeaders) ? MediaCandidateKind.file : null,
    referer: headerValue(requestHeaders, 'Referer'),
    userAgent: headerValue(requestHeaders, 'User-Agent'),
    origin: headerValue(requestHeaders, 'Origin'),
  );
}

MediaCandidate? candidateFromBridgeMessage(Object? payload) {
  if (payload is! Map) return null;
  final url = payload['url'];
  if (url is! String || url.isEmpty) return null;
  final kind = switch (payload['kind']) {
    'hls' => MediaCandidateKind.hls,
    'video' => MediaCandidateKind.file,
    'iframe' => MediaCandidateKind.iframe,
    _ => null,
  };
  if (kind == null) return null;
  final frame = payload['frame'];
  final ua = payload['ua'];
  return MediaCandidate(
    url: url,
    kind: kind,
    referer: frame is String ? frame : null,
    userAgent: ua is String ? ua : null,
  );
}

class ResolveCancelToken {
  final _cancelled = Completer<void>();

  bool get isCancelled => _cancelled.isCompleted;

  Future<void> get whenCancelled => _cancelled.future;

  void cancel() {
    if (!_cancelled.isCompleted) _cancelled.complete();
  }
}

class _ProbeSlots {
  _ProbeSlots(this.max) : assert(max > 0);

  final int max;
  int _active = 0;
  final _waiters = Queue<Completer<void>>();

  int get active => _active;

  Future<bool> acquire(Future<void> abandon) async {
    if (_active < max) {
      _active++;
      return true;
    }
    final waiter = Completer<void>();
    _waiters.add(waiter);
    await Future.any([waiter.future, abandon]);
    if (waiter.isCompleted) return true;
    _waiters.remove(waiter);
    return false;
  }

  void release() {
    if (_waiters.isNotEmpty) {
      _waiters.removeFirst().complete();
    } else {
      _active--;
    }
  }
}

class VideoResolver {
  VideoResolver({
    required PageProbeFactory probeFactory,
    this.timeout = const Duration(seconds: 25),
    this.fileGrace = const Duration(milliseconds: 1500),
    int maxConcurrentProbes = 2,
  })  : _probeFactory = probeFactory,
        _slots = _ProbeSlots(maxConcurrentProbes);

  final PageProbeFactory _probeFactory;
  final _ProbeSlots _slots;
  final Duration timeout;
  final Duration fileGrace;

  int get activeProbes => _slots.active;

  Future<VideoSource> resolve(VideoSource source, {ResolveCancelToken? cancelToken}) {
    if (cancelToken?.isCancelled ?? false) {
      return Future.error(const VideoResolveException(VideoResolveFailure.cancelled, '解析已取消'));
    }
    if (!isAllowedWebUrl(source.url)) {
      return Future.error(VideoResolveException(
        VideoResolveFailure.unsupportedUrl,
        '只支持 HTTP(S) 地址：${source.url}',
      ));
    }
    if (!source.isPage) return Future.value(source);
    return _PageResolution(this, source, cancelToken ?? ResolveCancelToken()).start();
  }
}

class _PageResolution {
  _PageResolution(this._resolver, this._source, this._token);

  final VideoResolver _resolver;
  final VideoSource _source;
  final ResolveCancelToken _token;
  final _outcome = Completer<VideoSource>();
  final _settled = Completer<void>();
  Timer? _deadline;
  Timer? _grace;
  MediaCandidate? _pendingFile;
  String? _observedUserAgent;

  bool get _isSettled => _settled.isCompleted;

  Future<VideoSource> start() {
    _deadline = Timer(_resolver.timeout, _onDeadline);
    _token.whenCancelled.then((_) => _fail(VideoResolveFailure.cancelled, '解析已取消'));
    unawaited(_drive());
    return _outcome.future;
  }

  Future<void> _drive() async {
    if (!await _resolver._slots.acquire(_settled.future)) return;
    PageProbe? probe;
    try {
      if (!_isSettled) {
        final request = PageProbeRequest(pageUrl: _source.url, headers: _source.headers);
        probe = await _resolver._probeFactory(request, _onCandidate);
        if (!_isSettled) await _settled.future;
      }
    } catch (error) {
      _fail(VideoResolveFailure.probeFailed, '播放页解析器启动失败：$error');
    } finally {
      try {
        await probe?.dispose();
      } finally {
        _resolver._slots.release();
      }
    }
  }

  void _onCandidate(MediaCandidate candidate) {
    if (_isSettled) return;
    _observedUserAgent ??= candidate.userAgent;
    if (candidate.kind == MediaCandidateKind.iframe) {
      final embedded = embeddedMediaUrl(candidate.url);
      if (embedded == null) return;
      _onCandidate(MediaCandidate(
        url: embedded,
        referer: candidate.url,
        userAgent: candidate.userAgent,
      ));
      return;
    }
    final kind = classifyMediaUrl(candidate.url, hint: candidate.kind);
    if (kind == MediaCandidateKind.hls) {
      _succeed(candidate);
    } else if (kind == MediaCandidateKind.file && _pendingFile == null) {
      _pendingFile = candidate;
      _grace = Timer(_resolver.fileGrace, () => _succeed(candidate));
    }
  }

  void _onDeadline() {
    final pending = _pendingFile;
    if (pending != null) {
      _succeed(pending);
    } else {
      _fail(VideoResolveFailure.timeout, '播放页解析超时（${_resolver.timeout.inSeconds} 秒）');
    }
  }

  void _succeed(MediaCandidate candidate) {
    if (_isSettled) return;
    _settle();
    _outcome.complete(VideoSource(
      quality: _source.quality,
      url: candidate.url.trim(),
      headers: _playbackHeaders(candidate),
    ));
  }

  void _fail(VideoResolveFailure failure, String message) {
    if (_isSettled) return;
    _settle();
    _outcome.completeError(VideoResolveException(failure, message));
  }

  void _settle() {
    _deadline?.cancel();
    _grace?.cancel();
    _settled.complete();
  }

  Map<String, String> _playbackHeaders(MediaCandidate candidate) {
    final referer = isAllowedWebUrl(candidate.referer) ? candidate.referer! : _source.url;
    final userAgent = candidate.userAgent ??
        _observedUserAgent ??
        headerValue(_source.headers, 'User-Agent');
    return Map.unmodifiable({
      'Referer': referer,
      if (userAgent != null) 'User-Agent': userAgent,
      if (candidate.origin != null) 'Origin': candidate.origin!,
    });
  }
}

class VideoResolveSession {
  VideoResolveSession(this._resolver);

  final VideoResolver _resolver;
  ResolveCancelToken? _current;
  int _generation = 0;

  Future<VideoSource> resolve(VideoSource source) async {
    _current?.cancel();
    final token = ResolveCancelToken();
    _current = token;
    final generation = ++_generation;
    final result = await _resolver.resolve(source, cancelToken: token);
    if (generation != _generation || token.isCancelled) {
      throw const VideoResolveException(VideoResolveFailure.cancelled, '已切换到其他剧集');
    }
    return result;
  }

  void cancel() {
    _current?.cancel();
    _current = null;
    _generation++;
  }
}
