import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/venera/venera_policy.dart';

import 'venera_test_support.dart';

final loginRoute = route('/login', (o, b) => FakeReply.text('ok', headers: {'set-cookie': ['sid=abc; Path=/']}));
const accountKey = 'titanhub.venera.account.venera-fixture_src';

void main() {
  final available = quickJsAvailable();
  final skip = available ? null : 'QuickJS 本机库不可用（需要 quickjs_c_bridge.dll 在 PATH）';

  test('密钥键按来源隔离', () {
    expect(veneraAccountSecretKey('venera-a'), isNot(veneraAccountSecretKey('venera-b')));
    expect(veneraAccountSecretKey('venera-a'), contains('venera-a'));
  });

  group('登录口令加密存储', skip: skip, () {
    test('登录后口令进入安全存储，数据文件不含账号口令', () async {
      final secrets = MemorySecrets();
      final h = SourceHarness.create([loginRoute], config: true, secrets: secrets);
      addTearDown(h.dispose);
      await h.source.login('alice', 'hunter2');
      expect(jsonDecode(secrets.values[accountKey]!), ['alice', 'hunter2']);
      final file = h.store.dataFile('venera-fixture_src');
      final text = await file.readAsString();
      expect(text, isNot(contains('hunter2')));
      expect(text, isNot(contains('alice')));
      expect((await h.source.info()).isLogged, isTrue);
    });

    test('登出清除安全存储', () async {
      final secrets = MemorySecrets();
      final h = SourceHarness.create([loginRoute], config: true, secrets: secrets);
      addTearDown(h.dispose);
      await h.source.login('alice', 'pw');
      await h.source.logout();
      expect(secrets.values.containsKey(accountKey), isFalse);
      expect((await h.source.info()).isLogged, isFalse);
    });

    test('重建来源时从安全存储恢复登录态', () async {
      final secrets = MemorySecrets();
      final shared = Directory.systemTemp.createTempSync('venera-secret');
      addTearDown(() => shared.deleteSync(recursive: true));
      final first = SourceHarness.create([loginRoute], config: true, secrets: secrets, sharedDir: shared);
      await first.source.login('alice', 'pw');
      await Future<void>.delayed(const Duration(milliseconds: 50));
      first.dispose();
      final second = SourceHarness.create([loginRoute], config: true, secrets: secrets, sharedDir: shared);
      addTearDown(second.dispose);
      expect((await second.source.info()).isLogged, isTrue);
    });

    test('旧版明文账号被迁移进安全存储并从文件移除', () async {
      final secrets = MemorySecrets();
      final shared = Directory.systemTemp.createTempSync('venera-legacy');
      addTearDown(() => shared.deleteSync(recursive: true));
      final probe = SourceHarness.create([loginRoute], config: true, sharedDir: shared);
      await probe.store.writeJsonMap(probe.store.dataFile('venera-fixture_src'), {
        'account': ['legacy', 'oldpw'],
      });
      probe.dispose();
      final h = SourceHarness.create([loginRoute], config: true, secrets: secrets, sharedDir: shared);
      addTearDown(h.dispose);
      expect((await h.source.info()).isLogged, isTrue);
      expect(jsonDecode(secrets.values[accountKey]!), ['legacy', 'oldpw']);
      expect(await h.store.dataFile('venera-fixture_src').readAsString(), isNot(contains('oldpw')));
    });

    test('不同来源的口令互不可见', () async {
      final secrets = MemorySecrets();
      final shared = Directory.systemTemp.createTempSync('venera-iso-secret');
      addTearDown(() => shared.deleteSync(recursive: true));
      final a = SourceHarness.create([loginRoute], key: 'src_a', config: true, secrets: secrets, sharedDir: shared);
      final b = SourceHarness.create([loginRoute], key: 'src_b', config: true, secrets: secrets, sharedDir: shared);
      addTearDown(a.dispose);
      addTearDown(b.dispose);
      await a.source.login('u', 'p');
      expect(secrets.values.keys, ['titanhub.venera.account.venera-src_a']);
      expect((await b.source.info()).isLogged, isFalse);
    });

    test('没有安全存储时口令不落盘', () async {
      final h = SourceHarness.create([loginRoute], config: true);
      addTearDown(h.dispose);
      await h.source.login('alice', 'hunter2');
      expect(await h.store.dataFile('venera-fixture_src').readAsString(), isNot(contains('hunter2')));
    });
  });
}
