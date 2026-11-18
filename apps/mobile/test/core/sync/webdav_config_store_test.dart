import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sync/webdav_config_store.dart';

class MemoryKeyValue implements SecureKeyValue {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

const _config = StoredWebDavConfig(
  url: 'https://dav.example.com/dav',
  username: 'alice',
  password: 'pw-secret',
  allowInsecureHttp: false,
);

void main() {
  late MemoryKeyValue storage;
  late WebDavConfigStore store;

  setUp(() {
    storage = MemoryKeyValue();
    store = WebDavConfigStore(storage);
  });

  test('未保存时返回 null', () async {
    expect(await store.load(), isNull);
  });

  test('以单个 JSON blob 保存并原样读回', () async {
    await store.save(_config);

    expect(storage.values.keys, [webDavConfigStorageKey]);
    expect(jsonDecode(storage.values[webDavConfigStorageKey]!), {
      'url': 'https://dav.example.com/dav',
      'username': 'alice',
      'password': 'pw-secret',
      'allowInsecureHttp': false,
    });
    final loaded = await store.load();
    expect(loaded!.url, _config.url);
    expect(loaded.username, _config.username);
    expect(loaded.password, _config.password);
    expect(loaded.allowInsecureHttp, isFalse);
  });

  test('toString 不泄露密码', () {
    expect(_config.toString(), isNot(contains('pw-secret')));
  });

  test('clear 只删除配置键', () async {
    storage.values['other'] = 'keep';
    await store.save(_config);

    await store.clear();

    expect(storage.values, {'other': 'keep'});
    expect(await store.load(), isNull);
  });

  test('拒绝保存不完整配置', () async {
    const empty = StoredWebDavConfig(
      url: 'https://dav.example.com/dav',
      username: 'alice',
      password: '',
      allowInsecureHttp: false,
    );

    await expectLater(store.save(empty), throwsArgumentError);
    expect(storage.values, isEmpty);
  });

  for (final raw in ['not json', '[]', '{"url":"https://x","username":"a","password":1,"allowInsecureHttp":false}',
      '{"url":"","username":"a","password":"p","allowInsecureHttp":false}']) {
    test('损坏数据明确报错且不回显内容: $raw', () async {
      storage.values[webDavConfigStorageKey] = raw;

      final error = await store.load().then<Object?>((_) => null, onError: (Object e) => e);

      expect(error, isA<WebDavConfigCorrupted>());
      expect(error.toString(), isNot(contains(raw)));
    });
  }
}
