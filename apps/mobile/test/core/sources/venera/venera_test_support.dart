import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/venera/venera_engine.dart';
import 'package:titanhub/core/sources/venera/venera_host.dart';
import 'package:titanhub/core/sources/venera/venera_models.dart';
import 'package:titanhub/core/sources/venera/venera_source.dart';
import 'package:titanhub/core/sources/venera/venera_store.dart';
import 'package:titanhub/core/sync/webdav_config_store.dart';

class FakeRoute {
  FakeRoute(this.match, this.respond);

  final bool Function(RequestOptions options) match;
  final FutureOr<FakeReply> Function(RequestOptions options, String body) respond;
}

class FakeReply {
  FakeReply(this.body, {this.status = 200, this.headers = const {}, this.delay = Duration.zero});

  final List<int> body;
  final int status;
  final Map<String, List<String>> headers;
  final Duration delay;

  factory FakeReply.text(String text, {int status = 200, Map<String, List<String>> headers = const {}}) =>
      FakeReply(utf8.encode(text), status: status, headers: headers);
}

class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.routes);

  final List<FakeRoute> routes;
  final List<RequestOptions> requests = [];
  final List<String> bodies = [];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(options);
    var body = '';
    if (requestStream != null) {
      final bytes = <int>[];
      await for (final chunk in requestStream) {
        bytes.addAll(chunk);
      }
      body = utf8.decode(bytes, allowMalformed: true);
    }
    bodies.add(body);
    for (final route in routes) {
      if (route.match(options)) {
        final reply = await route.respond(options, body);
        if (reply.delay > Duration.zero) await Future<void>.delayed(reply.delay);
        return ResponseBody.fromBytes(reply.body, reply.status, headers: reply.headers);
      }
    }
    return ResponseBody.fromBytes(utf8.encode('not found'), 404);
  }

  @override
  void close({bool force = false}) {}
}

Dio fakeDio(FakeAdapter adapter) {
  final dio = Dio(BaseOptions(validateStatus: (_) => true));
  dio.httpClientAdapter = adapter;
  return dio;
}

FakeRoute route(String pathContains, FutureOr<FakeReply> Function(RequestOptions options, String body) respond) =>
    FakeRoute((o) => o.uri.toString().contains(pathContains), respond);

bool quickJsAvailable() {
  try {
    final runtime = createVeneraRuntime();
    final ok = runtime.evaluate('1+1').stringResult == '2';
    runtime.dispose();
    return ok;
  } catch (_) {
    return false;
  }
}

String fixtureSourceCode() => File('test/core/sources/venera/fixtures/fixture_source.js').readAsStringSync();

Matcher throwsVenera(Pattern message) =>
    throwsA(predicate((Object e) => e.toString().contains(message)));

InstalledVeneraSource fixtureMeta({String key = 'fixture_src', bool config = false}) => InstalledVeneraSource(
      id: 'venera-$key',
      key: key,
      name: '夹具漫画',
      version: '1.0.0',
      fileName: '$key.js',
      downloadUrl: '',
      catalogUrl: '',
      enabled: true,
      installedAt: DateTime.utc(2024),
      updatedAt: DateTime.utc(2024),
      hints: VeneraConfigHints(hasAccount: config, hasSettings: config),
    );

class SourceHarness {
  SourceHarness(this.adapter, this.dir, this.store, this.source);

  final FakeAdapter adapter;
  final Directory dir;
  final VeneraStore store;
  final VeneraSource source;

  static SourceHarness create(
    List<FakeRoute> routes, {
    String? code,
    String key = 'fixture_src',
    Directory? sharedDir,
    VeneraLimits limits = const VeneraLimits(),
    bool config = false,
    SecureKeyValue? secrets,
    DateTime Function()? clock,
    int infoCacheMaxEntries = veneraInfoCacheMaxEntries,
  }) {
    final dir = sharedDir ?? Directory.systemTemp.createTempSync('venera-test');
    final adapter = FakeAdapter(routes);
    final store = VeneraStore(dir);
    final source = VeneraSource(
      fixtureMeta(key: key, config: config),
      code ?? fixtureSourceCode().replaceAll('fixture_src', key),
      store: store,
      limits: limits,
      dio: fakeDio(adapter),
      secrets: secrets,
      clock: clock,
      infoCacheMaxEntries: infoCacheMaxEntries,
    );
    return SourceHarness(adapter, dir, store, source);
  }

  void dispose() {
    source.dispose();
  }
}

class MemorySecrets implements SecureKeyValue {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}
