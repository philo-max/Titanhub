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

  test('VeneraImageRegistry fillImageRangeAt preserves exact slice height without stretching', () {
    // 4 horizontal bands of height 2 each (total 4x8): red, green, blue, yellow.
    final src = img.Image(width: 4, height: 8, numChannels: 4);
    final colors = [
      (255, 0, 0),
      (0, 255, 0),
      (0, 0, 255),
      (255, 255, 0),
    ];
    for (var b = 0; b < 4; b++) {
      final (r, g, bl) = colors[b];
      for (var y = b * 2; y < b * 2 + 2; y++) {
        for (var x = 0; x < 4; x++) {
          src.setPixelRgba(x, y, r, g, bl, 255);
        }
      }
    }

    final reg = VeneraImageRegistry(src);
    final outKey = reg.dispatch({'function': 'empty', 'width': 4, 'height': 8}) as int;
    // Reverse bands exactly like JM modifyImage does via fillImageRangeAt.
    var dstY = 0;
    for (var b = 3; b >= 0; b--) {
      reg.dispatch({
        'function': 'fillImageRangeAt',
        'key': outKey,
        'x': 0,
        'y': dstY,
        'image': 1,
        'srcX': 0,
        'srcY': b * 2,
        'width': 4,
        'height': 2,
      });
      dstY += 2;
    }

    final out = reg.get(outKey)!;
    // Band 0 in output should be yellow (originally band 3)
    expect((out.getPixel(1, 0).r, out.getPixel(1, 0).g, out.getPixel(1, 0).b), (255, 255, 0));
    expect((out.getPixel(1, 1).r, out.getPixel(1, 1).g, out.getPixel(1, 1).b), (255, 255, 0));
    // Band 1 in output should be blue (originally band 2)
    expect((out.getPixel(1, 2).r, out.getPixel(1, 2).g, out.getPixel(1, 2).b), (0, 0, 255));
    // Band 2 in output should be green (originally band 1)
    expect((out.getPixel(1, 4).r, out.getPixel(1, 4).g, out.getPixel(1, 4).b), (0, 255, 0));
    // Band 3 in output should be red (originally band 0)
    expect((out.getPixel(1, 6).r, out.getPixel(1, 6).g, out.getPixel(1, 6).b), (255, 0, 0));
    expect((out.getPixel(1, 7).r, out.getPixel(1, 7).g, out.getPixel(1, 7).b), (255, 0, 0));
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
