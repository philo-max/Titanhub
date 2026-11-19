import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:xml/xml.dart';

import 'sync_protocol.dart';

const Duration requestTimeout = Duration(milliseconds: 15000);
const int maxDirectoryEntries = 10000;
const int maxGetRedirects = 3;

bool _isPrivateRedirectHost(String host) {
  final normalized = host.toLowerCase().replaceAll(RegExp(r'^\[|\]$'), '');
  if (normalized.isEmpty || normalized == 'localhost' || normalized.endsWith('.local')) return true;
  if (RegExp(r'^(0\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)')
      .hasMatch(normalized)) {
    return true;
  }
  if (normalized == '::1' ||
      normalized == '::' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc00:') ||
      normalized.startsWith('fd00:') ||
      normalized.startsWith('::ffff:')) {
    return true;
  }
  return false;
}

class DavException implements Exception {
  const DavException(this.message);

  final String message;

  @override
  String toString() => 'DavException: $message';
}

class DavError extends DavException {
  DavError(this.status, this.method) : super('WebDAV $method: HTTP $status');

  final int status;
  final String method;
}

class WebDavConfig {
  const WebDavConfig({
    required this.url,
    required this.username,
    required this.password,
    this.allowInsecureHttp = false,
  });

  final String url;
  final String username;
  final String password;
  final bool allowInsecureHttp;
}

class DavResponse {
  const DavResponse({required this.status, required this.bytes});

  final int status;
  final String bytes;
}

class DavEntry {
  const DavEntry({required this.path, required this.collection});

  final String path;
  final bool collection;
}

class WebDavTransport {
  WebDavTransport(WebDavConfig config, {HttpClientAdapter? adapter})
      : root = _normalizeRoot(config),
        _authorization = 'Basic ${base64.encode(utf8.encode('${config.username}:${config.password}'))}',
        _dio = Dio(BaseOptions(
          connectTimeout: requestTimeout,
          sendTimeout: requestTimeout,
          receiveTimeout: requestTimeout,
          responseType: ResponseType.stream,
          followRedirects: false,
          validateStatus: (_) => true,
        )) {
    if (adapter != null) _dio.httpClientAdapter = adapter;
  }

  final Uri root;
  final String _authorization;
  final Dio _dio;

  void dispose() => _dio.close(force: true);

  static Uri _normalizeRoot(WebDavConfig config) {
    var raw = config.url;
    while (raw.endsWith('?') || raw.endsWith('#')) {
      raw = raw.substring(0, raw.length - 1);
    }
    final Uri parsed;
    try {
      parsed = Uri.parse(raw);
    } catch (_) {
      throw const DavException('Invalid WebDAV URL');
    }
    if (!parsed.hasScheme || parsed.host.isEmpty) throw const DavException('Invalid WebDAV URL');
    if (parsed.userInfo.isNotEmpty || parsed.query.isNotEmpty || parsed.fragment.isNotEmpty) {
      throw const DavException('WebDAV URL must not contain credentials, query or fragment');
    }
    if (parsed.scheme != 'https' && !(parsed.scheme == 'http' && config.allowInsecureHttp)) {
      throw const DavException('WebDAV requires HTTPS');
    }
    if (!raw.endsWith('/')) raw = '$raw/';
    try {
      return Uri.parse(raw);
    } catch (_) {
      throw const DavException('Invalid WebDAV URL');
    }
  }

  static String _origin(Uri uri) => '${uri.scheme}://${uri.host}:${uri.port}';

  Uri resolve(String path) {
    final Uri url;
    try {
      url = root.resolve(path.replaceAll('\\', '/'));
    } catch (_) {
      throw const DavException('Invalid WebDAV path');
    }
    if (_origin(url) != _origin(root) ||
        url.userInfo.isNotEmpty ||
        url.query.isNotEmpty ||
        url.fragment.isNotEmpty ||
        !url.path.startsWith(root.path)) {
      throw const DavException('WebDAV path outside configured root');
    }
    final String decoded;
    try {
      decoded = Uri.decodeComponent(url.path);
    } catch (_) {
      throw const DavException('Invalid WebDAV path');
    }
    if (decoded.contains('\\') || decoded.split('/').any((segment) => segment == '..' || segment == '.')) {
      throw const DavException('Invalid WebDAV path');
    }
    return url;
  }

  Future<DavResponse> request(
    String method,
    String path, {
    String? body,
    Map<String, String> headers = const {},
    bool allow404 = false,
  }) async {
    if (body != null && utf8.encode(body).length > maxSnapshotBytes) {
      throw const DavException('WebDAV request too large');
    }
    final uri = resolve(path);
    final cancelToken = CancelToken();
    try {
      return await _send(method, uri, body, headers, allow404, cancelToken).timeout(requestTimeout);
    } on TimeoutException {
      cancelToken.cancel('timeout');
      throw const DavException('WebDAV request timed out');
    } on DavException {
      rethrow;
    } catch (_) {
      throw const DavException('WebDAV network or response error');
    }
  }

  Future<DavResponse> _send(
    String method,
    Uri uri,
    String? body,
    Map<String, String> headers,
    bool allow404,
    CancelToken cancelToken,
  ) async {
    var currentUri = uri;
    late Response<ResponseBody> response;
    late int status;
    for (var hop = 0;; hop++) {
      final requestHeaders = <String, String>{...headers};
      if (_origin(currentUri) == _origin(root)) {
        requestHeaders['Authorization'] = _authorization;
      } else {
        requestHeaders.remove('Authorization');
        requestHeaders.remove('authorization');
      }
      response = await _dio.requestUri<ResponseBody>(
        currentUri,
        data: _origin(currentUri) == _origin(root) ? body : null,
        cancelToken: cancelToken,
        options: Options(
          method: method,
          headers: requestHeaders,
        ),
      );
      status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        final canFollow = (method == 'GET' || method == 'HEAD') && hop < maxGetRedirects;
        final location = response.headers.value('location');
        await response.data?.stream.drain<void>().catchError((_) {});
        if (!canFollow || location == null || location.isEmpty) {
          throw const DavException('WebDAV redirects are not allowed');
        }
        final Uri nextUri;
        try {
          nextUri = currentUri.resolve(location);
        } catch (_) {
          throw const DavException('WebDAV redirects are not allowed');
        }
        if (nextUri.scheme != 'https' || _isPrivateRedirectHost(nextUri.host)) {
          throw const DavException('WebDAV redirects are not allowed');
        }
        currentUri = nextUri;
        continue;
      }
      break;
    }
    if ((status < 200 || status >= 300) && !(allow404 && status == 404)) throw DavError(status, method);
    final declared = int.tryParse(response.headers.value('content-length') ?? '');
    if (declared != null && declared > maxSnapshotBytes) {
      throw const DavException('WebDAV response too large');
    }
    final builder = BytesBuilder(copy: false);
    final stream = response.data?.stream;
    if (stream != null) {
      await for (final chunk in stream) {
        if (builder.length + chunk.length > maxSnapshotBytes) {
          cancelToken.cancel('too large');
          throw const DavException('WebDAV response too large');
        }
        builder.add(chunk);
      }
    }
    return DavResponse(status: status, bytes: utf8.decode(builder.takeBytes(), allowMalformed: true));
  }

  Future<void> mkdir(String path) async {
    try {
      await request('MKCOL', path);
    } on DavError catch (error) {
      if (error.status != 405) rethrow;
      await list(path);
    }
  }

  Future<List<DavEntry>> list(String path) async {
    final response = await request(
      'PROPFIND',
      path,
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
      headers: const {'Depth': '1', 'Content-Type': 'application/xml'},
    );
    if (response.status != 207 || RegExp(r'<!DOCTYPE|<!ENTITY', caseSensitive: false).hasMatch(response.bytes)) {
      throw const DavException('WebDAV invalid directory XML');
    }
    final XmlDocument document;
    try {
      document = XmlDocument.parse(response.bytes);
    } catch (_) {
      throw const DavException('WebDAV invalid directory XML');
    }
    final rootElement = document.rootElement;
    if (rootElement.name.local != 'multistatus' || rootElement.name.namespaceUri != 'DAV:') {
      throw const DavException('WebDAV invalid directory XML');
    }
    final nodes = document.findAllElements('response', namespaceUri: 'DAV:').toList();
    if (nodes.length > maxDirectoryEntries) throw const DavException('WebDAV directory too large');
    final parent = resolve(path);
    final result = <DavEntry>[];
    for (final node in nodes) {
      final hrefs = node.findAllElements('href', namespaceUri: 'DAV:');
      final href = hrefs.isEmpty ? null : hrefs.first.innerText;
      if (href == null || href.isEmpty) throw const DavException('WebDAV missing directory href');
      final url = resolve(parent.resolve(href).toString());
      if (url.path == parent.path) continue;
      final insideParent = url.path.startsWith(parent.path);
      final tail = insideParent ? url.path.substring(parent.path.length).replaceFirst(RegExp(r'/$'), '') : '';
      if (!insideParent || tail.isEmpty || tail.contains('/')) {
        throw const DavException('WebDAV invalid directory href');
      }
      final statuses = node.findAllElements('status', namespaceUri: 'DAV:').toList();
      if (statuses.isEmpty || !statuses.any((status) => RegExp(r'\s200\s').hasMatch(status.innerText))) {
        throw const DavException('WebDAV failed directory entry');
      }
      result.add(DavEntry(
        path: url.toString(),
        collection: node.findAllElements('collection', namespaceUri: 'DAV:').isNotEmpty,
      ));
    }
    return result;
  }
}
