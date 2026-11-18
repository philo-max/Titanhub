import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/venera/venera_aes.dart';
import 'package:titanhub/core/sources/venera/venera_cookies.dart';

import 'venera_test_support.dart';

Uint8List hexBytes(String hex) => Uint8List.fromList([
      for (var i = 0; i < hex.length; i += 2) int.parse(hex.substring(i, i + 2), radix: 16),
    ]);

String toHex(List<int> bytes) => bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

Future<String> evalJs(String expression, {List<FakeRoute> routes = const []}) async {
  final code = fixtureSourceCode().replaceAll(
    'const json = JSON.parse(res.body)\n      return {\n        comics:',
    'const json = { items: [{ id: String(await (async () => ($expression))()), name: "t" }] }\n      return {\n        comics:',
  );
  final h = SourceHarness.create([route('/search', (o, b) => FakeReply.text('{}')), ...routes], code: code);
  try {
    final List result = await h.source.call('search', ['x']);
    return result.first['id'] as String;
  } finally {
    h.dispose();
  }
}

void main() {
  group('AES 纯 Dart 实现', () {
    test('FIPS-197 AES-128 向量', () {
      final aes = VeneraAes(hexBytes('000102030405060708090a0b0c0d0e0f'));
      final plain = hexBytes('00112233445566778899aabbccddeeff');
      final cipher = aes.encryptBlock(plain);
      expect(toHex(cipher), '69c4e0d86a7b0430d8cdb78070b4c55a');
      expect(toHex(aes.decryptBlock(cipher)), toHex(plain));
    });

    test('FIPS-197 AES-192 与 AES-256 向量', () {
      final plain = hexBytes('00112233445566778899aabbccddeeff');
      expect(
        toHex(VeneraAes(hexBytes('000102030405060708090a0b0c0d0e0f1011121314151617')).encryptBlock(plain)),
        'dda97ca4864cdfe06eaf70a0ec0d7191',
      );
      expect(
        toHex(VeneraAes(hexBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')).encryptBlock(plain)),
        '8ea2b7ca516745bfeafc49904b496089',
      );
    });

    test('CBC 与 ECB 往返，错误长度被拒绝', () {
      final aes = VeneraAes(hexBytes('2b7e151628aed2a6abf7158809cf4f3c'));
      final iv = hexBytes('000102030405060708090a0b0c0d0e0f');
      final data = Uint8List.fromList(List.generate(48, (i) => i));
      expect(aes.cbc(aes.cbc(data, iv, encrypt: true), iv, encrypt: false), data);
      expect(aes.ecb(aes.ecb(data, encrypt: true), encrypt: false), data);
      expect(
        toHex(aes.cbc(hexBytes('6bc1bee22e409f96e93d7e117393172a'), iv, encrypt: true)),
        '7649abac8119b246cee98e9b12e9197d',
      );
      expect(() => aes.ecb(Uint8List(15), encrypt: true), throwsArgumentError);
      expect(() => VeneraAes(Uint8List(10)), throwsArgumentError);
    });
  });

  group('Cookie 罐', () {
    test('Set-Cookie 解析、域与路径匹配、过期删除', () {
      final jar = VeneraCookieJar();
      final uri = Uri.parse('https://www.a.test/x/y');
      jar.storeFromResponse(uri, ['a=1; Path=/; Domain=a.test', 'b=2; Path=/zzz', 'c=3; Max-Age=0']);
      expect(jar.headerFor(uri), 'a=1');
      expect(jar.headerFor(Uri.parse('https://other.test/')), isNull);
      expect(jar.headerFor(Uri.parse('https://sub.a.test/')), 'a=1');
      jar.storeFromResponse(uri, ['bad=1; Domain=evil.test']);
      expect(jar.headerFor(uri), 'a=1');
      jar.deleteForUri(uri);
      expect(jar.isEmpty, isTrue);
    });
  });

  final available = quickJsAvailable();
  final skip = available ? null : 'QuickJS 本机库不可用';

  group('Venera 宿主 API（真实 QuickJS）', skip: skip, () {
    test('Convert 编码与哈希', () async {
      expect(await evalJs('Convert.hexEncode(Convert.md5(Convert.encodeUtf8("abc")))'), '900150983cd24fb0d6963f7d28e17f72');
      expect(await evalJs('Convert.hexEncode(Convert.sha1(Convert.encodeUtf8("abc")))'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
      expect(await evalJs('Convert.hexEncode(Convert.sha256(Convert.encodeUtf8("abc")))'),
          'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      expect(await evalJs('Convert.hexEncode(Convert.sha512(Convert.encodeUtf8("abc"))).slice(0, 16)'), 'ddaf35a193617aba');
      expect(await evalJs('Convert.encodeBase64(Convert.encodeUtf8("hello 你好"))'), 'aGVsbG8g5L2g5aW9');
      expect(await evalJs('Convert.decodeUtf8(Convert.decodeBase64("aGVsbG8g5L2g5aW9"))'), 'hello 你好');
    });

    test('Convert HMAC', () async {
      expect(
        await evalJs('Convert.hmacString(Convert.encodeUtf8("key"), Convert.encodeUtf8("The quick brown fox jumps over the lazy dog"), "sha256")'),
        'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
      );
      expect(
        await evalJs('Convert.hexEncode(Convert.hmac(Convert.encodeUtf8("key"), Convert.encodeUtf8("The quick brown fox jumps over the lazy dog"), "md5"))'),
        '80070713463e7749b90c2dc24911e275',
      );
    });

    test('Convert AES ECB/CBC 与 Dart 实现一致且可往返', () async {
      const key = 'Convert.decodeBase64("K34VFiiu0qar9xWICc9PPA==")';
      const iv = 'Convert.decodeBase64("AAECAwQFBgcICQoLDA0ODw==")';
      final cipher = await evalJs('Convert.hexEncode(Convert.encryptAesCbc(Convert.decodeBase64("a8G+4i5An5bpPX4Rc5MXKg=="), $key, $iv))');
      expect(cipher, '7649abac8119b246cee98e9b12e9197d');
      expect(await evalJs('Convert.hexEncode(Convert.decryptAesCbc(Convert.encryptAesCbc(Convert.decodeBase64("a8G+4i5An5bpPX4Rc5MXKg=="), $key, $iv), $key, $iv))'),
          '6bc1bee22e409f96e93d7e117393172a');
      expect(await evalJs('Convert.hexEncode(Convert.decryptAesEcb(Convert.encryptAesEcb(Convert.decodeBase64("a8G+4i5An5bpPX4Rc5MXKg=="), $key), $key))'),
          '6bc1bee22e409f96e93d7e117393172a');
    });

    test('createUuid / randomInt / atob / btoa', () async {
      expect(await evalJs('createUuid()'), matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
      expect(await evalJs('randomInt(5, 5)'), '5');
      expect(await evalJs('btoa("abc") + atob("YWJj")'), 'YWJjabc');
    });

    test('setTimeout 通过宿主定时器恢复，Network 支持 post/put/delete/patch', () async {
      expect(await evalJs('await new Promise(r => setTimeout(() => r("late"), 20))'), 'late');
      final routes = [
        route('/m', (o, b) => FakeReply.text('${o.method}:$b')),
      ];
      expect(await evalJs('(await Network.post("https://fixture.test/m", {}, "p")).body', routes: routes), 'POST:p');
      expect(await evalJs('(await Network.put("https://fixture.test/m", {}, "q")).body', routes: routes), 'PUT:q');
      expect(await evalJs('(await Network.patch("https://fixture.test/m", {}, "r")).body', routes: routes), 'PATCH:r');
      expect(await evalJs('(await Network.delete("https://fixture.test/m", {})).body', routes: routes), startsWith('DELETE'));
      expect(await evalJs('(await Network.sendRequest("GET", "https://fixture.test/m", {})).status', routes: routes), '200');
    });

    test('Network JSON 请求体、二进制响应与 fetch', () async {
      final routes = [
        route('/json', (o, b) => FakeReply.text('${o.headers['Content-Type']}|$b')),
        route('/bin', (o, b) => FakeReply([1, 2, 3, 255])),
      ];
      expect(await evalJs('(await Network.post("https://fixture.test/json", {}, {a: 1})).body', routes: routes),
          'application/json|{"a":1}');
      expect(await evalJs('Convert.hexEncode((await Network.fetchBytes("GET", "https://fixture.test/bin", {})).body)', routes: routes), '010203ff');
      expect(await evalJs('await (await fetch("https://fixture.test/json", {method: "POST", body: "z"})).text()', routes: routes), contains('|z'));
    });

    test('HtmlDocument 导航、属性与文本', () async {
      const html = '<div id=\\"root\\" class=\\"a b\\"><p>one</p><p class=\\"x\\">two<b>!</b></p><!--c--></div>';
      String run(String expr) => 'await (async () => { const d = new HtmlDocument("$html"); const r = $expr; d.dispose(); return r; })()';
      expect(await evalJs(run('d.querySelectorAll("p").length')), '2');
      expect(await evalJs(run('d.querySelector("p.x").text')), 'two!');
      expect(await evalJs(run('d.getElementById("root").classNames.join(",")')), 'a,b');
      expect(await evalJs(run('d.querySelector("p").nextElementSibling.localName')), 'p');
      expect(await evalJs(run('d.querySelector("p.x").previousElementSibling.text')), 'one');
      expect(await evalJs(run('d.querySelector("b").parent.id + "|" + d.querySelector("b").parent.parent.id')), '|root');
      expect(await evalJs(run('d.querySelector("#root").children.length')), '2');
      expect(await evalJs(run('d.querySelector("#root").nodes.map(n => n.type).join(",")')), 'element,element,comment');
      expect(await evalJs(run('d.querySelector("#root").nodes[0].toElement().text')), 'one');
      expect(await evalJs(run('d.querySelector("p.x").innerHTML')), 'two<b>!</b>');
      expect(await evalJs(run('JSON.stringify(d.querySelector("#root").attributes)')), contains('"class":"a b"'));
      expect(await evalJs(run('d.querySelector(".none")')), 'null');
    });

    test('已释放的 HtmlDocument 报错', () async {
      await expectLater(
        evalJs('await (async () => { const d = new HtmlDocument("<p>x</p>"); d.dispose(); return d.querySelector("p"); })()'),
        throwsVenera('已被释放'),
      );
    });

    test('补齐旧版 QuickJS 缺失的标准库：at/findLast/toReversed/hasOwn/structuredClone/URL', () async {
      expect(await evalJs('[1, 2, 3].at(-1) + "x".at(0) + [1, 2, 3].findLast(n => n < 3) + [1, 2].toReversed().join("")'), '3x221');
      expect(await evalJs('Object.hasOwn({a: 1}, "a") + "|" + JSON.stringify(structuredClone({b: [1]}))'), 'true|{"b":[1]}');
      expect(await evalJs('(() => { const u = new URL("/p/q?x=1&y=a%20b#h", "https://ex.test:8080/base/"); return [u.origin, u.pathname, u.searchParams.get("y"), u.hash].join("|"); })()'),
          'https://ex.test:8080|/p/q|a b|#h');
    });

    test('saveData / loadData / deleteData 在来源内保持', () async {
      expect(await evalJs('(this.saveData("k", {a: [1, 2]}), JSON.stringify(this.loadData("k")))'), '{"a":[1,2]}');
      expect(await evalJs('(this.deleteData("k"), String(this.loadData("k")))'), 'undefined');
      expect(await evalJs('this.loadSetting("quality")'), 'hd');
      await expectLater(evalJs('this.loadSetting("nope")'), throwsVenera('Setting not found'));
    });
  });
}
