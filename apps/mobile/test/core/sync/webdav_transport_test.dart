import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sync/sync_protocol.dart';
import 'package:titanhub/core/sync/webdav_transport.dart';

typedef _Handler = FutureOr<ResponseBody> Function(RequestOptions options);

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.handler);

  final _Handler handler;
  final List<RequestOptions> calls = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    calls.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _xml(String body, {int status = 207}) => ResponseBody.fromString(
      body,
      status,
      headers: {
        Headers.contentTypeHeader: ['application/xml'],
      },
    );

const _propfind = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';

String _multiStatus(List<String> entries) => '<?xml version="1.0" encoding="utf-8"?>'
    '<d:multistatus xmlns:d="DAV:">${entries.join()}</d:multistatus>';

String _entry(String href, {bool collection = false, String status = 'HTTP/1.1 200 OK'}) =>
    '<d:response><d:href>$href</d:href><d:propstat><d:prop>'
    '<d:resourcetype>${collection ? '<d:collection/>' : ''}</d:resourcetype>'
    '</d:prop><d:status>$status</d:status></d:propstat></d:response>';

WebDavTransport _transport(_FakeAdapter adapter, {String url = 'https://dav.example.com/root/'}) =>
    WebDavTransport(
      WebDavConfig(url: url, username: 'user', password: 'pass'),
      adapter: adapter,
    );

void main() {
  group('configuration', () {
    test('requires HTTPS unless insecure http is allowed', () {
      expect(
        () => WebDavTransport(const WebDavConfig(url: 'http://dav.example.com/root', username: 'u', password: 'p')),
        throwsA(isA<DavException>()),
      );
      expect(
        () => WebDavTransport(const WebDavConfig(
          url: 'http://dav.example.com/root',
          username: 'u',
          password: 'p',
          allowInsecureHttp: true,
        )),
        returnsNormally,
      );
    });

    test('rejects invalid urls', () {
      for (final url in [
        'not a url',
        'https://dav.example.com/root?token=1',
        'https://dav.example.com/root#frag',
        'https://user:pass@dav.example.com/root',
      ]) {
        expect(
          () => WebDavTransport(WebDavConfig(url: url, username: 'u', password: 'p')),
          throwsA(isA<DavException>()),
          reason: url,
        );
      }
    });

    test('normalizes root with trailing slash', () {
      final transport = _transport(_FakeAdapter((_) => _xml('')), url: 'https://dav.example.com/root');
      expect(transport.root.path, '/root/');
    });
  });

  group('resolve', () {
    late WebDavTransport transport;

    setUp(() {
      transport = _transport(_FakeAdapter((_) => _xml('')));
    });

    test('resolves paths under the root', () {
      expect(transport.resolve('a/b.json').toString(), 'https://dav.example.com/root/a/b.json');
      expect(transport.resolve('a%20b/').toString(), 'https://dav.example.com/root/a%20b/');
      expect(transport.resolve(r'a\b.json').toString(), 'https://dav.example.com/root/a/b.json');
      expect(transport.resolve('a/%2e%2e/b').toString(), 'https://dav.example.com/root/b');
      expect(transport.resolve('a%252Eb').toString(), 'https://dav.example.com/root/a%252Eb');
    });

    test('rejects escapes and traversal', () {
      for (final path in [
        'https://evil.example.com/root/a',
        '//evil.example.com/root/a',
        '../outside.json',
        'a/../../outside.json',
        'a%5Cb',
        '/other/a.json',
        'a?query=1',
        'a#frag',
      ]) {
        expect(() => transport.resolve(path), throwsA(isA<DavException>()), reason: path);
      }
    });
  });

  group('request', () {
    test('sends basic auth and returns utf8 body', () async {
      final adapter = _FakeAdapter((_) => ResponseBody.fromString('héllo', 200));
      final transport = _transport(adapter);

      final response = await transport.request('GET', 'file.txt');

      expect(response.status, 200);
      expect(response.bytes, 'héllo');
      final options = adapter.calls.single;
      expect(options.method, 'GET');
      expect(options.uri.toString(), 'https://dav.example.com/root/file.txt');
      expect(options.headers['Authorization'], 'Basic ${base64.encode(utf8.encode('user:pass'))}');
    });

    test('throws DavError for unexpected status', () async {
      final transport = _transport(_FakeAdapter((_) => ResponseBody.fromString('', 500)));

      await expectLater(
        transport.request('GET', 'file.txt'),
        throwsA(isA<DavError>()
            .having((error) => error.status, 'status', 500)
            .having((error) => error.method, 'method', 'GET')),
      );
    });

    test('allows 404 only when requested', () async {
      final transport = _transport(_FakeAdapter((_) => ResponseBody.fromString('', 404)));

      final response = await transport.request('GET', 'missing.json', allow404: true);
      expect(response.status, 404);

      await expectLater(transport.request('GET', 'missing.json'), throwsA(isA<DavError>()));
    });

    test('rejects redirects', () async {
      final transport = _transport(_FakeAdapter((_) => ResponseBody.fromString('', 302)));

      await expectLater(
        transport.request('GET', 'file.txt'),
        throwsA(isA<DavException>().having((error) => error.message, 'message', 'WebDAV redirects are not allowed')),
      );
    });

    test('rejects oversized request bodies', () async {
      final transport = _transport(_FakeAdapter((_) => ResponseBody.fromString('', 201)));

      await expectLater(
        transport.request('PUT', 'file.json', body: 'x' * (maxSnapshotBytes + 1)),
        throwsA(isA<DavException>().having((error) => error.message, 'message', 'WebDAV request too large')),
      );
    });

    test('rejects oversized responses from content-length', () async {
      final transport = _transport(_FakeAdapter(
        (_) => ResponseBody.fromString(
          'x',
          200,
          headers: {
            Headers.contentLengthHeader: ['${maxSnapshotBytes + 1}'],
          },
        ),
      ));

      await expectLater(
        transport.request('GET', 'file.json'),
        throwsA(isA<DavException>().having((error) => error.message, 'message', 'WebDAV response too large')),
      );
    });

    test('wraps transport failures as network errors', () async {
      final transport = _transport(_FakeAdapter((_) => throw const SocketFailure()));

      await expectLater(
        transport.request('GET', 'file.json'),
        throwsA(isA<DavException>().having((error) => error.message, 'message', 'WebDAV network or response error')),
      );
    });
  });

  group('mkdir', () {
    test('creates a collection', () async {
      final adapter = _FakeAdapter((_) => ResponseBody.fromString('', 201));
      final transport = _transport(adapter);

      await transport.mkdir('dir/');

      expect(adapter.calls.single.method, 'MKCOL');
      expect(adapter.calls.single.uri.path, '/root/dir/');
    });

    test('accepts existing collections after 405', () async {
      final adapter = _FakeAdapter((options) {
        if (options.method == 'MKCOL') return ResponseBody.fromString('', 405);
        return _xml(_multiStatus([_entry('/root/dir/', collection: true)]));
      });
      final transport = _transport(adapter);

      await transport.mkdir('dir/');

      expect(adapter.calls.map((call) => call.method), ['MKCOL', 'PROPFIND']);
    });

    test('propagates other failures', () async {
      final transport = _transport(_FakeAdapter((_) => ResponseBody.fromString('', 403)));

      await expectLater(transport.mkdir('dir/'), throwsA(isA<DavError>()));
    });
  });

  group('list', () {
    test('parses entries and skips the parent collection', () async {
      final adapter = _FakeAdapter((options) {
        expect(options.method, 'PROPFIND');
        expect(options.headers['Depth'], '1');
        expect(options.headers['Content-Type'], 'application/xml');
        expect(options.data, _propfind);
        return _xml(_multiStatus([
          _entry('/root/dir/'),
          _entry('/root/dir/a.json'),
          _entry('/root/dir/sub/', collection: true),
        ]));
      });
      final transport = _transport(adapter);

      final entries = await transport.list('dir/');

      expect(entries, hasLength(2));
      expect(entries[0].path, 'https://dav.example.com/root/dir/a.json');
      expect(entries[0].collection, isFalse);
      expect(entries[1].path, 'https://dav.example.com/root/dir/sub/');
      expect(entries[1].collection, isTrue);
    });

    test('decodes escaped hrefs', () async {
      final adapter = _FakeAdapter(
        (_) => _xml(_multiStatus([_entry('/root/dir/a%20b.json')])),
      );
      final transport = _transport(adapter);

      final entries = await transport.list('dir/');

      expect(entries.single.path, 'https://dav.example.com/root/dir/a%20b.json');
    });

    test('rejects invalid documents', () async {
      final cases = <ResponseBody>[
        _xml(_multiStatus([]), status: 200),
        _xml('<!DOCTYPE d:multistatus [<!ENTITY x "y">]>${_multiStatus([])}'),
        _xml('not xml at all'),
        _xml('<multistatus xmlns="urn:other"/>'),
        _xml('<d:multistatus xmlns:d="urn:other"/>'),
      ];

      for (final body in cases) {
        final transport = _transport(_FakeAdapter((_) => body));
        await expectLater(
          transport.list('dir/'),
          throwsA(isA<DavException>().having(
            (error) => error.message,
            'message',
            'WebDAV invalid directory XML',
          )),
        );
      }
    });

    test('rejects missing or failed entries', () async {
      final bodies = <String>[
        _multiStatus(['<d:response><d:href>/root/dir/a.json</d:href></d:response>']),
        _multiStatus([
          '<d:response><d:propstat><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>',
        ]),
        _multiStatus([_entry('/root/dir/a.json', status: 'HTTP/1.1 404 Not Found')]),
      ];

      for (final body in bodies) {
        final transport = _transport(_FakeAdapter((_) => _xml(body)));
        await expectLater(transport.list('dir/'), throwsA(isA<DavException>()), reason: body);
      }
    });

    test('rejects hrefs outside the listed collection', () async {
      for (final href in ['/root/other.json', '/root/dir/a/b.json', '/root/dir/../escape.json', 'https://evil.example.com/root/dir/a.json']) {
        final transport = _transport(_FakeAdapter((_) => _xml(_multiStatus([_entry(href)]))));
        await expectLater(
          transport.list('dir/'),
          throwsA(isA<DavException>()),
          reason: href,
        );
      }
    });

    test('rejects oversized directories', () async {
      final entries = [
        for (var i = 0; i <= maxDirectoryEntries; i++) _entry('/root/dir/$i.json'),
      ];
      final transport = _transport(_FakeAdapter((_) => _xml(_multiStatus(entries))));

      await expectLater(
        transport.list('dir/'),
        throwsA(isA<DavException>().having((error) => error.message, 'message', 'WebDAV directory too large')),
      );
    });
  });
}

class SocketFailure implements Exception {
  const SocketFailure();
}
