import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:titanhub/core/sources/venera/venera_image_proxy.dart';

void main() {
  test('VeneraImageRegistry swaps image halves via empty/copyRange/fillImageAt', () {
    final src = img.Image(width: 2, height: 4, numChannels: 4);
    for (var y = 0; y < 2; y++) {
      for (var x = 0; x < 2; x++) {
        src.setPixelRgba(x, y, 255, 0, 0, 255); // top half red
      }
    }
    for (var y = 2; y < 4; y++) {
      for (var x = 0; x < 2; x++) {
        src.setPixelRgba(x, y, 0, 0, 255, 255); // bottom half blue
      }
    }

    final reg = VeneraImageRegistry(src);
    expect(reg.dispatch({'function': 'getWidth', 'key': 1}), 2);
    expect(reg.dispatch({'function': 'getHeight', 'key': 1}), 4);

    final outKey = reg.dispatch({'function': 'empty', 'width': 2, 'height': 4}) as int;
    final topKey = reg.dispatch({'function': 'copyRange', 'key': 1, 'x': 0, 'y': 0, 'width': 2, 'height': 2}) as int;
    final botKey = reg.dispatch({'function': 'copyRange', 'key': 1, 'x': 0, 'y': 2, 'width': 2, 'height': 2}) as int;

    reg.dispatch({'function': 'fillImageAt', 'key': outKey, 'x': 0, 'y': 0, 'image': botKey});
    reg.dispatch({'function': 'fillImageAt', 'key': outKey, 'x': 0, 'y': 2, 'image': topKey});

    final out = reg.get(outKey)!;
    expect(out.getPixel(0, 0).b, 255);
    expect(out.getPixel(0, 0).r, 0);
    expect(out.getPixel(0, 3).r, 255);
    expect(out.getPixel(0, 3).b, 0);
  });

  test('VeneraImageProxy serves modified image bytes and caches subsequent requests', () async {
    final upstream = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => upstream.close(force: true));
    var upstreamHits = 0;
    upstream.listen((req) async {
      upstreamHits++;
      req.response
        ..statusCode = HttpStatus.ok
        ..add(Uint8List.fromList([1, 2, 3]));
      await req.response.close();
    });

    var modifierCalls = 0;
    final proxy = VeneraImageProxy(
      modifier: (raw, script) async {
        modifierCalls++;
        expect(raw, [1, 2, 3]);
        expect(script, 'function modifyImage(img){return img;}');
        return Uint8List.fromList([9, 8, 7]);
      },
    );
    addTearDown(proxy.dispose);

    final proxyUrl = await proxy.register(
      url: 'http://127.0.0.1:${upstream.port}/p1.jpg',
      headers: const {'Referer': 'https://example.test/'},
      modifyImageScript: 'function modifyImage(img){return img;}',
    );

    final client = HttpClient();
    addTearDown(client.close);

    final r1 = await (await client.getUrl(Uri.parse(proxyUrl))).close();
    final b1 = await r1.fold<List<int>>([], (a, b) => a..addAll(b));
    expect(r1.statusCode, HttpStatus.ok);
    expect(b1, [9, 8, 7]);

    final r2 = await (await client.getUrl(Uri.parse(proxyUrl))).close();
    final b2 = await r2.fold<List<int>>([], (a, b) => a..addAll(b));
    expect(r2.statusCode, HttpStatus.ok);
    expect(b2, [9, 8, 7]);
    expect(upstreamHits, 1);
    expect(modifierCalls, 1);
  });
}
