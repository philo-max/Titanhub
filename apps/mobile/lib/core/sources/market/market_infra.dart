import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';

class MarketException implements Exception {
  const MarketException(this.message);

  final String message;

  @override
  String toString() => message;
}

typedef MarketHttpGet = Future<List<int>> Function(String url, int maxBytes);

Future<List<int>> dioMarketHttpGet(String url, int maxBytes, {Dio? dio, Duration timeout = const Duration(seconds: 10)}) async {
  final client = dio ??
      Dio(BaseOptions(
        connectTimeout: timeout,
        receiveTimeout: timeout,
        sendTimeout: timeout,
        followRedirects: true,
        maxRedirects: 5,
        validateStatus: (_) => true,
      ));
  final Response<ResponseBody> response;
  try {
    response = await client.get<ResponseBody>(
      url,
      options: Options(
        responseType: ResponseType.stream,
        headers: {'Accept': 'application/json,text/plain,*/*'},
      ),
    );
  } on DioException catch (error) {
    final type = error.type;
    if (type == DioExceptionType.connectionTimeout ||
        type == DioExceptionType.receiveTimeout ||
        type == DioExceptionType.sendTimeout) {
      throw const MarketException('请求超时');
    }
    if (type == DioExceptionType.connectionError) {
      throw const MarketException('网络不可达');
    }
    throw MarketException('请求失败：${error.message ?? type}');
  }
  final status = response.statusCode ?? 0;
  if (status < 200 || status >= 300) {
    throw MarketException('HTTP $status');
  }
  final body = response.data;
  if (body == null) throw const MarketException('响应为空');
  final bytes = <int>[];
  try {
    await for (final chunk in body.stream.timeout(timeout)) {
      bytes.addAll(chunk);
      if (bytes.length > maxBytes) {
        throw const MarketException('响应超过大小上限');
      }
    }
  } on TimeoutException {
    throw const MarketException('读取超时');
  } on DioException catch (error) {
    throw MarketException('读取失败：${error.message ?? error.type}');
  }
  if (bytes.isEmpty) throw const MarketException('响应为空');
  return bytes;
}

class MirrorFetched {
  const MirrorFetched({required this.text, required this.json, required this.base});

  final String text;
  final Object? json;
  final String base;
}

class MirrorFetcher {
  MirrorFetcher({MarketHttpGet? httpGet}) : _httpGet = httpGet ?? dioMarketHttpGet;

  final MarketHttpGet _httpGet;
  String? _preferred;

  Future<MirrorFetched> fetch(
    List<String> bases,
    String path, {
    required int maxBytes,
    bool json = true,
    void Function(String text, Object? json)? validate,
  }) async {
    final ordered = [
      if (_preferred != null && bases.contains(_preferred)) _preferred!,
      for (final base in bases)
        if (base != _preferred) base,
    ];
    final failures = <String>[];
    for (final base in ordered) {
      final url = '$base$path';
      try {
        final bytes = await _httpGet(url, maxBytes);
        final text = utf8.decode(bytes);
        Object? decoded;
        if (json) {
          try {
            decoded = jsonDecode(text);
          } on FormatException {
            throw const MarketException('返回内容不是有效 JSON');
          }
        }
        if (validate != null) validate(text, decoded);
        _preferred = base;
        return MirrorFetched(text: text, json: decoded, base: base);
      } catch (error) {
        failures.add('${Uri.parse(url).host}: $error');
      }
    }
    throw MirrorException(failures);
  }
}

class MirrorException implements Exception {
  const MirrorException(this.failures);

  final List<String> failures;

  @override
  String toString() => '所有镜像均失败（${failures.join('；')}）';
}

String? normalizeCatalogBase(String input) {
  var value = input.trim();
  if (value.isEmpty) return null;
  final uri = Uri.tryParse(value);
  if (uri == null || uri.scheme != 'https' || uri.host.isEmpty || uri.userInfo.isNotEmpty) {
    return null;
  }
  if (uri.hasQuery || uri.hasFragment) return null;
  if (value.endsWith('/index.json')) {
    value = value.substring(0, value.length - 'index.json'.length);
  }
  return value.endsWith('/') ? value : '$value/';
}

int compareSourceVersions(String a, String b) {
  List<Object> tokens(String value) => [
        for (final match in RegExp(r'\d+|[A-Za-z]+').allMatches(value.trim()))
          int.tryParse(match.group(0)!) ?? match.group(0)!.toLowerCase(),
      ];
  final left = tokens(a);
  final right = tokens(b);
  final length = left.length > right.length ? left.length : right.length;
  for (var i = 0; i < length; i++) {
    final x = i < left.length ? left[i] : 0;
    final y = i < right.length ? right[i] : 0;
    final int result;
    if (x is int && y is int) {
      result = x.compareTo(y);
    } else {
      result = x.toString().compareTo(y.toString());
    }
    if (result != 0) return result;
  }
  return 0;
}

Future<void> writeFileAtomic(File file, String content) async {
  await file.parent.create(recursive: true);
  final temp = File('${file.path}.tmp');
  await temp.writeAsString(content, flush: true);
  await temp.rename(file.path);
}

enum MarketInstallStatus { installed, updated, upToDate, skipped, failed }

class MarketInstallItem {
  const MarketInstallItem({
    required this.id,
    required this.name,
    required this.status,
    this.message = '',
    this.version = '',
  });

  final String id;
  final String name;
  final MarketInstallStatus status;
  final String message;
  final String version;
}

class MarketInstallReport {
  const MarketInstallReport({
    required this.items,
    required this.catalogOrigin,
    this.catalogWarnings = const [],
  });

  final List<MarketInstallItem> items;
  final String catalogOrigin;
  final List<String> catalogWarnings;

  int count(MarketInstallStatus status) => items.where((i) => i.status == status).length;

  List<MarketInstallItem> get failures =>
      items.where((i) => i.status == MarketInstallStatus.failed).toList();

  String get summary =>
      '新装 ${count(MarketInstallStatus.installed)} · 更新 ${count(MarketInstallStatus.updated)} · '
      '已最新 ${count(MarketInstallStatus.upToDate)} · 跳过 ${count(MarketInstallStatus.skipped)} · '
      '失败 ${count(MarketInstallStatus.failed)}';
}
