import 'package:titanhub/core/sync/webdav_transport.dart';

typedef DavFault = Object? Function(String method, String key);

class MemoryWebDav implements WebDavTransport {
  MemoryWebDav({Map<String, String>? files, Set<String>? dirs})
      : files = files ?? {},
        dirs = {'', ...?dirs};

  @override
  final Uri root = Uri.parse('https://dav.test/dav/');
  final Map<String, String> files;
  final Set<String> dirs;
  final List<String> log = [];
  DavFault? failBefore;
  DavFault? failAfter;
  int disposed = 0;

  String key(String path) => resolve(path).path.substring(root.path.length);

  void seed(String path, String bytes) {
    final parts = path.split('/');
    for (var i = 1; i < parts.length; i++) {
      dirs.add('${parts.take(i).join('/')}/');
    }
    files[path] = bytes;
  }

  @override
  Uri resolve(String path) => root.resolve(path);

  @override
  Future<DavResponse> request(
    String method,
    String path, {
    String? body,
    Map<String, String> headers = const {},
    bool allow404 = false,
  }) async {
    final target = key(path);
    log.add('$method $target');
    final before = failBefore?.call(method, target);
    if (before != null) throw before;
    final response = _apply(method, target, body, headers, allow404);
    final after = failAfter?.call(method, target);
    if (after != null) throw after;
    return response;
  }

  DavResponse _apply(
    String method,
    String target,
    String? body,
    Map<String, String> headers,
    bool allow404,
  ) {
    DavResponse missing() {
      if (allow404) return const DavResponse(status: 404, bytes: '');
      throw DavError(404, method);
    }

    switch (method) {
      case 'GET':
        final value = files[target];
        return value == null ? missing() : DavResponse(status: 200, bytes: value);
      case 'PUT':
        if (headers['If-None-Match'] == '*' && files.containsKey(target)) throw DavError(412, method);
        files[target] = body ?? '';
        return const DavResponse(status: 201, bytes: '');
      case 'MOVE':
        final destination = key(headers['Destination']!);
        if (headers['Overwrite'] == 'F' && files.containsKey(destination)) throw DavError(412, method);
        final value = files.remove(target);
        if (value == null) return missing();
        files[destination] = value;
        return const DavResponse(status: 201, bytes: '');
      case 'DELETE':
        final existed = files.remove(target) != null || dirs.remove(target);
        if (target.endsWith('/')) {
          files.removeWhere((k, _) => k.startsWith(target));
          dirs.removeWhere((k) => k.startsWith(target));
        }
        return existed ? const DavResponse(status: 204, bytes: '') : missing();
      case 'MKCOL':
        if (dirs.contains(target)) throw DavError(405, method);
        dirs.add(target);
        return const DavResponse(status: 201, bytes: '');
    }
    throw DavError(405, method);
  }

  @override
  Future<void> mkdir(String path) async {
    try {
      await request('MKCOL', path);
    } on DavError catch (error) {
      if (error.status != 405) rethrow;
      await list(path);
    }
  }

  @override
  Future<List<DavEntry>> list(String path) async {
    final prefix = key(path);
    log.add('PROPFIND $prefix');
    if (!dirs.contains(prefix)) throw DavError(404, 'PROPFIND');
    bool child(String k) {
      if (!k.startsWith(prefix) || k == prefix) return false;
      final rest = k.substring(prefix.length);
      final trimmed = rest.endsWith('/') ? rest.substring(0, rest.length - 1) : rest;
      return !trimmed.contains('/');
    }

    return [
      for (final dir in dirs.where(child)) DavEntry(path: root.resolve(dir).toString(), collection: true),
      for (final file in files.keys.where(child))
        DavEntry(path: root.resolve(file).toString(), collection: false),
    ];
  }

  @override
  void dispose() => disposed++;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
