import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter_js/flutter_js.dart';
import 'package:image/image.dart' as img;

int _toInt(dynamic value, [int fallback = 0]) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) {
    return int.tryParse(value) ?? double.tryParse(value)?.toInt() ?? fallback;
  }
  return fallback;
}

/// Pure-Dart image buffer registry implementing Venera's JS `Image` host API.
class VeneraImageRegistry {
  VeneraImageRegistry(img.Image initial) {
    _images[1] = initial;
  }

  final Map<int, img.Image> _images = {};
  int _nextKey = 2;

  img.Image? get(int key) => _images[key];

  int _alloc(img.Image image) {
    final key = _nextKey++;
    _images[key] = image;
    return key;
  }

  dynamic dispatch(Map<String, dynamic> msg) {
    final fn = msg['function'] as String?;
    final key = _toInt(msg['key']);
    switch (fn) {
      case 'empty':
        final w = _toInt(msg['width'], 1).clamp(1, 16384);
        final h = _toInt(msg['height'], 1).clamp(1, 16384);
        return _alloc(img.Image(width: w, height: h, numChannels: 4));
      case 'getWidth':
        return _images[key]?.width ?? 0;
      case 'getHeight':
        return _images[key]?.height ?? 0;
      case 'copyRange':
        final src = _images[key];
        if (src == null) return null;
        final x = _toInt(msg['x']).clamp(0, src.width);
        final y = _toInt(msg['y']).clamp(0, src.height);
        final w = _toInt(msg['width']).clamp(1, src.width - x);
        final h = _toInt(msg['height']).clamp(1, src.height - y);
        return _alloc(img.copyCrop(src, x: x, y: y, width: w, height: h));
      case 'copyAndRotate90':
        final src = _images[key];
        if (src == null) return null;
        return _alloc(img.copyRotate(src, angle: 90));
      case 'fillImageAt':
        final dst = _images[key];
        final srcKey = _toInt(msg['image']);
        final src = _images[srcKey];
        if (dst == null || src == null) return null;
        img.compositeImage(
          dst,
          src,
          dstX: _toInt(msg['x']),
          dstY: _toInt(msg['y']),
          blend: img.BlendMode.direct,
        );
        return null;
      case 'fillImageRangeAt':
        final dst = _images[key];
        final srcKey = _toInt(msg['image']);
        final src = _images[srcKey];
        if (dst == null || src == null) return null;
        final w = _toInt(msg['width']);
        final h = _toInt(msg['height']);
        img.compositeImage(
          dst,
          src,
          dstX: _toInt(msg['x']),
          dstY: _toInt(msg['y']),
          dstW: w,
          dstH: h,
          srcX: _toInt(msg['srcX']),
          srcY: _toInt(msg['srcY']),
          srcW: w,
          srcH: h,
          blend: img.BlendMode.direct,
        );
        return null;
    }
    return null;
  }
}

/// Virtual image registry that tracks dimensions and records pixel operations
/// during QuickJS execution so heavy decode/composite/encode runs in a background
/// isolate without blocking the UI thread.
class _VirtualImageRecorder {
  _VirtualImageRecorder(int width, int height) {
    _dims[1] = (width, height);
  }

  final Map<int, (int w, int h)> _dims = {};
  final List<Map<String, dynamic>> ops = [];
  int _nextKey = 2;

  int _alloc(int w, int h) {
    final key = _nextKey++;
    _dims[key] = (w, h);
    return key;
  }

  dynamic dispatch(Map<String, dynamic> msg) {
    final fn = msg['function'] as String?;
    final key = _toInt(msg['key']);
    switch (fn) {
      case 'empty':
        final w = _toInt(msg['width'], 1).clamp(1, 16384);
        final h = _toInt(msg['height'], 1).clamp(1, 16384);
        ops.add({'function': 'empty', 'width': w, 'height': h});
        return _alloc(w, h);
      case 'getWidth':
        return _dims[key]?.$1 ?? 0;
      case 'getHeight':
        return _dims[key]?.$2 ?? 0;
      case 'copyRange':
        final src = _dims[key];
        if (src == null) return null;
        final x = _toInt(msg['x']);
        final y = _toInt(msg['y']);
        final w = _toInt(msg['width'], 1).clamp(1, 16384);
        final h = _toInt(msg['height'], 1).clamp(1, 16384);
        ops.add({
          'function': 'copyRange',
          'key': key,
          'x': x,
          'y': y,
          'width': w,
          'height': h,
        });
        return _alloc(w, h);
      case 'copyAndRotate90':
        final src = _dims[key];
        if (src == null) return null;
        ops.add({'function': 'copyAndRotate90', 'key': key});
        return _alloc(src.$2, src.$1);
      case 'fillImageAt':
        ops.add({
          'function': 'fillImageAt',
          'key': key,
          'x': _toInt(msg['x']),
          'y': _toInt(msg['y']),
          'image': _toInt(msg['image']),
        });
        return null;
      case 'fillImageRangeAt':
        ops.add({
          'function': 'fillImageRangeAt',
          'key': key,
          'x': _toInt(msg['x']),
          'y': _toInt(msg['y']),
          'image': _toInt(msg['image']),
          'srcX': _toInt(msg['srcX']),
          'srcY': _toInt(msg['srcY']),
          'width': _toInt(msg['width']),
          'height': _toInt(msg['height']),
        });
        return null;
    }
    return null;
  }
}

const String _imageJsShim = r'''
function __veneraImgCall(payload) {
  var raw = sendMessage('__venera_img__', JSON.stringify(payload));
  if (typeof raw === 'string') {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'v')) {
        return parsed.v;
      }
      return parsed;
    } catch (_) {
      return raw;
    }
  }
  return raw;
}
class Image {
  constructor(key) { this.key = Number(key); }
  static empty(width, height) {
    var k = __veneraImgCall({
      function: 'empty', width: Number(width), height: Number(height)
    });
    return new Image(k);
  }
  get width() {
    return Number(__veneraImgCall({
      function: 'getWidth', key: this.key
    }));
  }
  get height() {
    return Number(__veneraImgCall({
      function: 'getHeight', key: this.key
    }));
  }
  copyRange(x, y, width, height) {
    var k = __veneraImgCall({
      function: 'copyRange', key: this.key,
      x: Number(x), y: Number(y), width: Number(width), height: Number(height)
    });
    return k == null ? null : new Image(k);
  }
  copyAndRotate90() {
    var k = __veneraImgCall({
      function: 'copyAndRotate90', key: this.key
    });
    return k == null ? null : new Image(k);
  }
  fillImageAt(x, y, image) {
    __veneraImgCall({
      function: 'fillImageAt', key: this.key,
      x: Number(x), y: Number(y), image: Number(image.key)
    });
  }
  fillImageRangeAt(x, y, image, srcX, srcY, width, height) {
    __veneraImgCall({
      function: 'fillImageRangeAt', key: this.key,
      x: Number(x), y: Number(y), image: Number(image.key),
      srcX: Number(srcX), srcY: Number(srcY),
      width: Number(width), height: Number(height)
    });
  }
}
''';

Future<void> _jsModifyQueue = Future<void>.value();

Future<T> _runSerializedJs<T>(FutureOr<T> Function() action) {
  final completer = Completer<T>();
  _jsModifyQueue = _jsModifyQueue.catchError((_) {}).then((_) async {
    try {
      completer.complete(await action());
    } catch (e, st) {
      completer.completeError(e, st);
    }
  });
  return completer.future;
}

(int, int)? _probeImageDimensions(Uint8List rawBytes) {
  final decoder = img.findDecoderForData(rawBytes);
  if (decoder != null) {
    final info = decoder.startDecode(rawBytes);
    if (info != null && info.width > 0 && info.height > 0) {
      return (info.width, info.height);
    }
  }
  final decoded = img.decodeImage(rawBytes);
  if (decoded != null && decoded.width > 0 && decoded.height > 0) {
    return (decoded.width, decoded.height);
  }
  return null;
}

Uint8List _replayOpsInIsolate(
  Uint8List rawBytes,
  List<Map<String, dynamic>> ops,
  int outKey,
) {
  final decoded = img.decodeImage(rawBytes);
  if (decoded == null) {
    throw StateError('无法解码图片字节 (${rawBytes.length} bytes)');
  }
  if (ops.isEmpty) {
    return Uint8List.fromList(img.encodeJpg(decoded, quality: 92));
  }
  final registry = VeneraImageRegistry(decoded);
  for (final op in ops) {
    registry.dispatch(op);
  }
  final outImage = registry.get(outKey) ?? decoded;
  return Uint8List.fromList(img.encodeJpg(outImage, quality: 92));
}

/// Runs a Venera `modifyImage(image)` JS script on [rawBytes] and returns
/// re-encoded JPEG bytes. Heavy image decoding/encoding is offloaded to
/// background isolates while QuickJS calls are serialized.
Future<Uint8List> runVeneraModifyImage(Uint8List rawBytes, String script) async {
  final dims = await Isolate.run(() => _probeImageDimensions(rawBytes));
  if (dims == null) {
    throw StateError('无法解码图片字节 (${rawBytes.length} bytes)');
  }
  final recorder = _VirtualImageRecorder(dims.$1, dims.$2);
  final outKey = await _runSerializedJs<int>(() {
    final runtime = getJavascriptRuntime(xhr: false);
    try {
      runtime.onMessage('__venera_img__', (dynamic args) {
        final map = args is String
            ? jsonDecode(args) as Map<String, dynamic>
            : Map<String, dynamic>.from(args as Map);
        return jsonEncode({'v': recorder.dispatch(map)});
      });
      final res = runtime.evaluate('''
        $_imageJsShim
        ;
        $script
        ;
        (function() {
          var input = new Image(1);
          var out = modifyImage(input);
          return out && out.key ? out.key : 1;
        })();
      ''');
      if (res.isError) {
        throw StateError('modifyImage 执行失败: ${res.stringResult}');
      }
      return _toInt(res.stringResult.trim(), 1);
    } finally {
      runtime.dispose();
    }
  });
  final ops = recorder.ops;
  return Isolate.run(() => _replayOpsInIsolate(rawBytes, ops, outKey));
}

class _ProxyEntry {
  const _ProxyEntry({
    required this.url,
    required this.headers,
    required this.modifyImageScript,
  });

  final String url;
  final Map<String, String> headers;
  final String modifyImageScript;
}

typedef ImageModifier = Future<Uint8List> Function(Uint8List raw, String script);

/// Loopback HTTP proxy that downloads scrambled Venera images on demand,
/// applies `modifyImage` descrambling, and serves clean JPEG bytes to
/// `CachedNetworkImage` / `MangaReaderScreen`.
class VeneraImageProxy {
  VeneraImageProxy({
    Dio? dio,
    ImageModifier? modifier,
    int maxCacheEntries = 24,
  })  : _dio = dio ??
            Dio(BaseOptions(
              connectTimeout: const Duration(seconds: 20),
              receiveTimeout: const Duration(seconds: 25),
              sendTimeout: const Duration(seconds: 15),
            )),
        _modifier = modifier ?? runVeneraModifyImage,
        _maxCacheEntries = maxCacheEntries;

  static final VeneraImageProxy instance = VeneraImageProxy();

  final Dio _dio;
  final ImageModifier _modifier;
  final int _maxCacheEntries;
  final Map<String, _ProxyEntry> _entries = {};
  final LinkedHashMap<String, Uint8List> _cache = LinkedHashMap();
  final Map<String, Future<Uint8List>> _inflight = {};

  HttpServer? _server;
  int _counter = 0;

  Future<int> _ensureStarted() async {
    if (_server != null) return _server!.port;
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _server = server;
    server.listen(_handleRequest);
    return server.port;
  }

  Future<String> register({
    required String url,
    required Map<String, String> headers,
    required String modifyImageScript,
  }) async {
    final port = await _ensureStarted();
    final id = '${++_counter}';
    if (_entries.length > 400) {
      _entries.remove(_entries.keys.first);
    }
    _entries[id] = _ProxyEntry(
      url: url,
      headers: headers,
      modifyImageScript: modifyImageScript,
    );
    return 'http://127.0.0.1:$port/img/$id.jpg';
  }

  Future<Uint8List> _fetchAndModify(String id, _ProxyEntry entry) async {
    final sanitizedHeaders = <String, String>{
      for (final e in entry.headers.entries)
        if (e.key.toLowerCase() != 'accept-encoding') e.key: e.value,
    };
    final res = await _dio.get<List<int>>(
      entry.url,
      options: Options(
        headers: sanitizedHeaders,
        responseType: ResponseType.bytes,
      ),
    );
    final rawBytes = Uint8List.fromList(res.data ?? const <int>[]);
    if (rawBytes.isEmpty) {
      throw StateError('上游返回空图片响应 (${entry.url})');
    }
    final cleanBytes = await _modifier(rawBytes, entry.modifyImageScript);
    if (_cache.length >= _maxCacheEntries) {
      _cache.remove(_cache.keys.first);
    }
    _cache[id] = cleanBytes;
    return cleanBytes;
  }

  Future<void> _handleRequest(HttpRequest request) async {
    try {
      final path = request.uri.path;
      final match = RegExp(r'^/img/(\d+)\.jpg$').firstMatch(path);
      if (match == null) {
        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
        return;
      }
      final id = match.group(1)!;
      final cached = _cache[id];
      if (cached != null) {
        request.response
          ..statusCode = HttpStatus.ok
          ..headers.contentType = ContentType('image', 'jpeg')
          ..add(cached);
        await request.response.close();
        return;
      }
      final entry = _entries[id];
      if (entry == null) {
        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
        return;
      }
      final future = _inflight.putIfAbsent(id, () => _fetchAndModify(id, entry));
      Uint8List cleanBytes;
      try {
        cleanBytes = await future;
      } finally {
        if (identical(_inflight[id], future)) {
          _inflight.remove(id);
        }
      }
      request.response
        ..statusCode = HttpStatus.ok
        ..headers.contentType = ContentType('image', 'jpeg')
        ..add(cleanBytes);
      await request.response.close();
    } catch (e) {
      debugPrint('[VeneraImageProxy] ${request.uri.path} failed: $e');
      request.response.statusCode = HttpStatus.badGateway;
      await request.response.close();
    }
  }

  Future<void> dispose() async {
    await _server?.close(force: true);
    _server = null;
    _entries.clear();
    _cache.clear();
    _inflight.clear();
  }
}
