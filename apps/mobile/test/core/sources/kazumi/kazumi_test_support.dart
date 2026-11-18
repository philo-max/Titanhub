import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_rule.dart';

class FakeReply {
  const FakeReply(this.body, {this.status = 200, this.error});

  final String body;
  final int status;
  final DioException? error;
}

typedef FakeHandler = FakeReply Function(RequestOptions options);

class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);

  final FakeHandler handler;
  final List<RequestOptions> calls = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    final reply = handler(options);
    if (reply.error != null) throw reply.error!;
    return ResponseBody.fromBytes(
      utf8.encode(reply.body),
      reply.status,
      headers: {
        Headers.contentTypeHeader: ['text/html; charset=utf-8'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Dio fakeDio(FakeHandler handler, {FakeAdapter? adapter}) {
  final dio = Dio();
  dio.httpClientAdapter = adapter ?? FakeAdapter(handler);
  return dio;
}

String fixture(String name) => File('test/core/sources/kazumi/fixtures/$name').readAsStringSync();

Map<String, dynamic> bundledRuleJson(String name) =>
    jsonDecode(File('assets/kazumi/rules/$name.json').readAsStringSync()) as Map<String, dynamic>;

KazumiRule bundledRule(String name) => KazumiRule.fromJson(bundledRuleJson(name));

Future<String> assetLoader(String key) => File(key).readAsString();
