import 'dart:async';

import 'package:drift/drift.dart' hide isNull, isNotNull;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/identity/media_identity.dart';
import 'package:titanhub/core/storage/app_database.dart';
import 'package:titanhub/core/sync/webdav_config_store.dart';
import 'package:titanhub/core/sync/webdav_sync.dart';
import 'package:titanhub/core/sync/webdav_transport.dart';
import 'package:titanhub/features/tracking/webdav_provider.dart';

import '../../core/sync/memory_webdav.dart';

class _MemoryKeyValue implements SecureKeyValue {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

const _url = 'https://dav.example.com/dav';
const _password = 'pw-very-secret';

WebDavConfigInput _input({String url = _url, String user = 'alice', String? password = _password}) =>
    WebDavConfigInput(url: url, username: user, password: password, allowInsecureHttp: false);

void main() {
  late AppDatabase db;
  late WebDavConfigStore store;
  late MemoryWebDav dav;
  late List<WebDavConfig> configs;
  late SecureWebDavSyncGateway gateway;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    store = WebDavConfigStore(_MemoryKeyValue());
    dav = MemoryWebDav();
    configs = [];
    gateway = SecureWebDavSyncGateway(
      database: db,
      store: store,
      transportFactory: (config) {
        configs.add(config);
        return dav;
      },
    );
  });
  tearDown(() => db.close());

  test('保存后 loadConfig 只报告存在密码，不回显', () async {
    await gateway.saveConfig(_input());

    final saved = await gateway.loadConfig();
    expect(saved!.url, _url);
    expect(saved.username, 'alice');
    expect(saved.hasPassword, isTrue);
    expect((await store.load())!.password, _password);
  });

  test('同地址同账号空密码保留旧密码', () async {
    await gateway.saveConfig(_input());

    await gateway.saveConfig(_input(password: null));

    expect((await store.load())!.password, _password);
  });

  test('更换账号或地址时必须提供密码且不改动已保存配置', () async {
    await gateway.saveConfig(_input());

    await expectLater(gateway.saveConfig(_input(user: 'bob', password: null)),
        throwsA(isA<WebDavFormException>()));
    await expectLater(gateway.saveConfig(_input(url: 'https://other.example.com', password: null)),
        throwsA(isA<WebDavFormException>()));

    final stored = await store.load();
    expect(stored!.username, 'alice');
    expect(stored.url, _url);
  });

  test('连接测试使用表单临时配置、不保存，并释放传输', () async {
    await gateway.testConnection(_input(password: 'temp-pw'));

    expect(configs.single.password, 'temp-pw');
    expect(await store.load(), isNull);
    expect(dav.disposed, 1);
  });

  test('未保存配置时同步明确失败', () async {
    await expectLater(gateway.syncNow(), throwsA(isA<WebDavFormException>()));
    expect(configs, isEmpty);
  });

  test('同步使用保存的配置并返回状态', () async {
    await gateway.saveConfig(_input());

    final status = await gateway.syncNow();

    expect(configs.single.username, 'alice');
    expect(configs.single.password, _password);
    expect(status.lastSuccessAt, isNotNull);
    expect(status.pendingLocalChanges, 0);
    expect(dav.disposed, 1);
  });

  test('同步失败时脱敏、抛出且仍释放传输', () async {
    await gateway.saveConfig(_input());
    dav.failBefore = (method, key) => DavException('boom $_password');

    final error = await gateway.syncNow().then<Object?>((_) => null, onError: (Object e) => e);

    expect(error, isA<WebDavSyncException>());
    expect(error.toString(), isNot(contains(_password)));
    expect(dav.disposed, 1);
    expect(await db.getSyncPending(), isNull);
  });

  test('同步与连接测试单飞互斥', () async {
    await gateway.saveConfig(_input());
    final gate = Completer<void>();
    final blocking = MemoryWebDav();
    final slow = SecureWebDavSyncGateway(
      database: db,
      store: store,
      transportFactory: (_) => _GatedWebDav(blocking, gate.future),
    );

    final first = slow.syncNow();
    await expectLater(slow.testConnection(_input()), throwsA(isA<WebDavSyncException>()));
    await expectLater(slow.syncNow(), throwsA(isA<WebDavSyncException>()));
    gate.complete();
    await first;
  });

  test('clearConfig 只清配置不动本地同步状态', () async {
    await gateway.saveConfig(_input());
    final before = await db.getSyncDevice();

    await gateway.clearConfig();

    expect(await gateway.loadConfig(), isNull);
    expect((await db.getSyncDevice()).deviceId, before.deviceId);
  });

  test('本地有未发布变更时状态显示 1', () async {
    expect((await gateway.loadStatus()).pendingLocalChanges, 0);
    const identity = MediaIdentity(pluginId: 'mangadex', mediaType: 'manga', mediaId: 'a');
    await db.saveFavorite(LocalFavoritesCompanion(
      id: Value(identity.key),
      pluginId: const Value('mangadex'),
      mediaType: const Value('manga'),
      mediaId: const Value('a'),
    ));

    expect((await gateway.loadStatus()).pendingLocalChanges, 1);
  });
}

class _GatedWebDav extends MemoryWebDav {
  _GatedWebDav(MemoryWebDav base, this.gate) : super(files: base.files, dirs: base.dirs);

  final Future<void> gate;

  @override
  Future<void> mkdir(String path) async {
    await gate;
    await super.mkdir(path);
  }
}
