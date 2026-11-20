import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/network/mainland_channel.dart';

void main() {
  test('githubMirrorUrls generates Mainland mirror fallback chain for raw URLs', () {
    final mirrors = githubMirrorUrls(
      'https://raw.githubusercontent.com/Predidit/KazumiRules/main/index.json',
    );
    expect(mirrors, [
      'https://cdn.jsdelivr.net/gh/Predidit/KazumiRules@main/index.json',
      'https://fastly.jsdelivr.net/gh/Predidit/KazumiRules@main/index.json',
      'https://gh-proxy.com/https://raw.githubusercontent.com/Predidit/KazumiRules/main/index.json',
      'https://raw.githubusercontent.com/Predidit/KazumiRules/main/index.json',
    ]);
  });

  test('applyEdgeRelay formats query or template relay URLs', () {
    expect(applyEdgeRelay('https://api.mangadex.org/manga', null),
        'https://api.mangadex.org/manga');
    expect(
      applyEdgeRelay('https://api.mangadex.org/manga', 'https://w.test/?url='),
      'https://w.test/?url=https%3A%2F%2Fapi.mangadex.org%2Fmanga',
    );
    expect(
      applyEdgeRelay('https://api.mangadex.org/manga', 'https://w.test/proxy?u={url}'),
      'https://w.test/proxy?u=https%3A%2F%2Fapi.mangadex.org%2Fmanga',
    );
  });

  test('MainlandDohResolver falls back from AliDNS to DNSPod and caches', () async {
    final requests = <String>[];
    final dio = Dio();
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      requests.add(options.uri.toString());
      if (options.uri.host == '223.5.5.5') {
        handler.reject(DioException(requestOptions: options));
        return;
      }
      handler.resolve(Response(requestOptions: options, statusCode: 200, data: {
        'Answer': [
          {'type': 1, 'TTL': 120, 'data': '104.21.10.20'},
        ],
      }));
    }));

    final resolver = MainlandDohResolver(dio: dio);
    expect(await resolver.resolveA('example.com'), '104.21.10.20');
    expect(await resolver.resolveA('example.com'), '104.21.10.20');
    expect(requests.length, 2); // 1 failed AliDNS + 1 DNSPod, second call cached
  });

  test('MainlandDohProxy routes poisoned hostname to resolved IP', () async {
    final target = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => target.close(force: true));
    target.listen((req) async {
      req.response
        ..statusCode = HttpStatus.ok
        ..write('DOH_OK:${req.uri.path}');
      await req.response.close();
    });

    final dohDio = Dio()
      ..interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
        handler.resolve(Response(requestOptions: options, statusCode: 200, data: {
          'Answer': [
            {'type': 1, 'TTL': 120, 'data': '127.0.0.1'},
          ],
        }));
      }));
    final proxy = MainlandDohProxy(resolver: MainlandDohResolver(dio: dohDio));
    final proxyPort = await proxy.start();
    addTearDown(proxy.stop);

    final client = HttpClient()
      ..findProxy = (_) => 'PROXY 127.0.0.1:$proxyPort';
    addTearDown(client.close);

    final req = await client.getUrl(
      Uri.parse('http://poisoned.example.test:${target.port}/hello'),
    );
    final res = await req.close();
    final body = await utf8.decodeStream(res);
    expect(res.statusCode, HttpStatus.ok);
    expect(body, 'DOH_OK:/hello');
  });
}
