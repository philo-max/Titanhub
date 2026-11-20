import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_js/flutter_js.dart';
import 'package:image/image.dart' as img;

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
    final key = (msg['key'] as num?)?.toInt() ?? 0;
    switch (fn) {
      case 'empty':
        final w = (msg['width'] as num).toInt().clamp(1, 16384);
        final h = (msg['height'] as num).toInt().clamp(1, 16384);
        return _alloc(img.Image(width: w, height: h, numChannels: 4));
      case 'getWidth':
        return _images[key]?.width ?? 0;
      case 'getHeight':
        return _images[key]?.height ?? 0;
      case 'copyRange':
        final src = _images[key];
        if (src == null) return null;
        final x = (msg['x'] as num).toInt();
        final y = (msg['y'] as num).toInt();
        final w = (msg['width'] as num).toInt();
        final h = (msg['height'] as num).toInt();
        return _alloc(img.copyCrop(src, x: x, y: y, width: w, height: h));
      case 'copyAndRotate90':
        final src = _images[key];
        if (src == null) return null;
        return _alloc(img.copyRotate(src, angle: 90));
      case 'fillImageAt':
        final dst = _images[key];
        final srcKey = (msg['image'] as num?)?.toInt() ?? 0;
        final src = _images[srcKey];
        if (dst == null || src == null) return null;
        img.compositeImage(
          dst,
          src,
          dstX: (msg['x'] as num).toInt(),
          dstY: (msg['y'] as num).toInt(),
          blend: img.BlendMode.direct,
        );
        return null;
      case 'fillImageRangeAt':
        final dst = _images[key];
        final srcKey = (msg['image'] as num?)?.toInt() ?? 0;
        final src = _images[srcKey];
        if (dst == null || src == null) return null;
        img.compositeImage(
          dst,
          src,
          dstX: (msg['x'] as num).toInt(),
          dstY: (msg['y'] as num).toInt(),
          srcX: (msg['srcX'] as num).toInt(),
          srcY: (msg['srcY'] as num).toInt(),
          srcW: (msg['width'] as num).toInt(),
          srcH: (msg['height'] as num).toInt(),
          blend: img.BlendMode.direct,
        );
        return null;
    }
    return null;
  }
}

const String _imageJsShim = r'''
class Image {
  constructor(key) { this.key = key; }
  static empty(width, height) {
    var k = sendMessage('__venera_img__', JSON.stringify({
      function: 'empty', width: width, height: height
    }));
    return new Image(k);
  }
  get width() {
    return sendMessage('__venera_img__', JSON.stringify({
      function: 'getWidth', key: this.key
    }));
  }
  get height() {
    return sendMessage('__venera_img__', JSON.stringify({
      function: 'getHeight', key: this.key
    }));
  }
  copyRange(x, y, width, height) {
    var k = sendMessage('__venera_img__', JSON.stringify({
      function: 'copyRange', key: this.key, x: x, y: y, width: width, height: height
    }));
    return k == null ? null : new Image(k);
  }
  copyAndRotate90() {
    var k = sendMessage('__venera_img__', JSON.stringify({
      function: 'copyAndRotate90', key: this.key
    }));
    return k == null ? null : new Image(k);
  }
  fillImageAt(x, y, image) {
    sendMessage('__venera_img__', JSON.stringify({
      function: 'fillImageAt', key: this.key, x: x, y: y, image: image.key
    }));
  }
  fillImageRangeAt(x, y, image, srcX, srcY, width, height) {
    sendMessage('__venera_img__', JSON.stringify({
      function: 'fillImageRangeAt', key: this.key, x: x, y: y,
      image: image.key, srcX: srcX, srcY: srcY, width: width, height: height
    }));
  }
}
''';

/// Runs a Venera `modifyImage(image)` JS script on [rawBytes] and returns
/// re-encoded JPEG/PNG bytes.
Future<Uint8List> runVeneraModifyImage(Uint8List rawBytes, String script) async {
  final decoded = img.decodeImage(rawBytes);
  if (decoded == null) {
    throw StateError('无法解码图片字节');
  }
  final registry = VeneraImageRegistry(decoded);
  final runtime = getJavascriptRuntime();
  try {
    runtime.onMessage('__venera_img__', (dynamic args) {
      final map = args is String
          ? jsonDecode(args) as Map<String, dynamic>
          : Map<String, dynamic>.from(args as Map);
      return registry.dispatch(map);
    });
    final res = runtime.evaluate('''
      $_imageJsShim
      $script
      (function() {
        var input = new Image(1);
        var out = modifyImage(input);
        return out && out.key ? out.key : 1;
      })();
    ''');
    if (res.isError) {
      throw StateError('modifyImage 执行失败: ${res.stringResult}');
    }
    final outKey = int.tryParse(res.stringResult.trim()) ?? 1;
    final outImage = registry.get(outKey) ?? decoded;
    return Uint8List.fromList(img.encodeJpg(outImage, quality: 92));
  } finally {
    runtime.dispose();
  }
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
  })  : _dio = dio ?? Dio(),
        _modifier = modifier ?? runVeneraModifyImage,
        _maxCacheEntries = maxCacheEntries;

  static final VeneraImageProxy instance = VeneraImageProxy();

  final Dio _dio;
  final ImageModifier _modifier;
  final int _maxCacheEntries;
  final Map<String, _ProxyEntry> _entries = {};
  final LinkedHashMap<String, Uint8List> _cache = LinkedHashMap();

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
      final res = await _dio.get<List<int>>(
        entry.url,
        options: Options(
          headers: entry.headers,
          responseType: ResponseType.bytes,
        ),
      );
      final rawBytes = Uint8List.fromList(res.data ?? const <int>[]);
      final cleanBytes = await _modifier(rawBytes, entry.modifyImageScript);
      if (_cache.length >= _maxCacheEntries) {
        _cache.remove(_cache.keys.first);
      }
      _cache[id] = cleanBytes;
      request.response
        ..statusCode = HttpStatus.ok
        ..headers.contentType = ContentType('image', 'jpeg')
        ..add(cleanBytes);
      await request.response.close();
    } catch (_) {
      request.response.statusCode = HttpStatus.badGateway;
      await request.response.close();
    }
  }

  Future<void> dispose() async {
    await _server?.close(force: true);
    _server = null;
    _entries.clear();
    _cache.clear();
  }
}
