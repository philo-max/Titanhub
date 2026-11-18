import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/features/tracking/webdav_provider.dart';
import 'package:titanhub/features/tracking/webdav_settings_screen.dart';

const _savedUrl = 'https://dav.example.com/dav';
const _savedUser = 'alice';
const _oldPassword = 's3cret-old-password';

class _FakeGateway implements WebDavSyncGateway {
  WebDavSavedConfig? saved;
  String? storedPassword;
  WebDavSyncStatus status = const WebDavSyncStatus();
  final calls = <String>[];
  final savedInputs = <WebDavConfigInput>[];
  final testedInputs = <WebDavConfigInput>[];
  Completer<WebDavSyncStatus>? syncGate;
  Object? testError;
  Object? saveError;

  void seedSaved() {
    saved = const WebDavSavedConfig(
      url: _savedUrl,
      username: _savedUser,
      allowInsecureHttp: false,
      hasPassword: true,
    );
    storedPassword = _oldPassword;
  }

  @override
  Future<WebDavSavedConfig?> loadConfig() async {
    calls.add('load');
    return saved;
  }

  @override
  Future<WebDavSyncStatus> loadStatus() async => status;

  @override
  Future<void> saveConfig(WebDavConfigInput input) async {
    calls.add('save');
    savedInputs.add(input);
    final error = saveError;
    if (error != null) throw error;
    if (input.password != null) storedPassword = input.password;
    saved = WebDavSavedConfig(
      url: input.url,
      username: input.username,
      allowInsecureHttp: input.allowInsecureHttp,
      hasPassword: storedPassword != null,
    );
  }

  @override
  Future<void> testConnection(WebDavConfigInput input) async {
    calls.add('test');
    testedInputs.add(input);
    final error = testError;
    if (error != null) throw error;
  }

  @override
  Future<WebDavSyncStatus> syncNow() async {
    calls.add('sync');
    status = await (syncGate?.future ?? Future.value(status));
    return status;
  }

  @override
  Future<void> clearConfig() async {
    calls.add('clear');
    saved = null;
    storedPassword = null;
  }
}

ProviderContainer _container(WebDavSyncGateway? gateway) {
  final container = ProviderContainer(
    overrides: [
      if (gateway != null) webDavGatewayProvider.overrideWithValue(gateway),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

Future<void> _pumpScreen(WidgetTester tester, ProviderContainer container) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: WebDavSettingsScreen()),
    ),
  );
  await tester.pump();
  await tester.pumpAndSettle();
}

TextEditingController _field(WidgetTester tester, String key) =>
    tester.widget<TextField>(find.byKey(Key(key))).controller!;

Future<void> _enter(WidgetTester tester, String key, String text) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.enterText(find.byKey(Key(key)), text);
  await tester.pump();
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pump();
  await tester.tap(find.byKey(Key(key)));
  await tester.pump();
}

String _boxText(WidgetTester tester, String key) {
  final text = tester.widget<Text>(
    find.descendant(of: find.byKey(Key(key)), matching: find.byType(Text)),
  );
  return text.data ?? '';
}

bool _enabled(WidgetTester tester, String key) =>
    tester.widget<ButtonStyleButton>(find.byKey(Key(key))).onPressed != null;

void main() {
  testWidgets('加载已保存配置时回填地址与用户名，旧密码不回显', (tester) async {
    final gateway = _FakeGateway()..seedSaved();
    await _pumpScreen(tester, _container(gateway));

    expect(_field(tester, 'webdav-url').text, _savedUrl);
    expect(_field(tester, 'webdav-username').text, _savedUser);
    expect(_field(tester, 'webdav-password').text, isEmpty);
    expect(find.textContaining(_oldPassword), findsNothing);
    expect(find.textContaining('留空即保留原密码'), findsOneWidget);
    expect(find.textContaining('不依赖电脑'), findsOneWidget);
    expect(find.textContaining('同一个 WebDAV 地址'), findsOneWidget);
    expect(find.textContaining('只同步收藏与观看/阅读进度'), findsOneWidget);
    expect(find.textContaining('不会同步或安装来源'), findsOneWidget);
  });

  testWidgets('HTTP 默认被拒绝，显式开启后提示明文风险并可保存', (tester) async {
    final gateway = _FakeGateway();
    await _pumpScreen(tester, _container(gateway));

    await _enter(tester, 'webdav-url', 'http://192.168.1.2:5005/dav/');
    await _enter(tester, 'webdav-username', 'bob');
    await _enter(tester, 'webdav-password', 'new-pass');
    expect(find.byKey(const Key('webdav-http-warning')), findsNothing);

    await _tap(tester, 'webdav-save');
    await tester.pumpAndSettle();
    expect(_boxText(tester, 'webdav-error'), contains('HTTPS'));
    expect(gateway.savedInputs, isEmpty);

    await _tap(tester, 'webdav-allow-http');
    expect(find.byKey(const Key('webdav-http-warning')), findsOneWidget);
    expect(_boxText(tester, 'webdav-http-warning'), contains('明文'));

    await _tap(tester, 'webdav-save');
    await tester.pumpAndSettle();
    expect(gateway.savedInputs, hasLength(1));
    final input = gateway.savedInputs.single;
    expect(input.url, 'http://192.168.1.2:5005/dav');
    expect(input.username, 'bob');
    expect(input.password, 'new-pass');
    expect(input.allowInsecureHttp, isTrue);
    expect(_field(tester, 'webdav-password').text, isEmpty);
    expect(find.byKey(const Key('webdav-notice')), findsOneWidget);
  });

  testWidgets('地址与账号不变且密码留空时保留原密码', (tester) async {
    final gateway = _FakeGateway()..seedSaved();
    await _pumpScreen(tester, _container(gateway));

    await _enter(tester, 'webdav-url', '$_savedUrl/');
    await _tap(tester, 'webdav-save');
    await tester.pumpAndSettle();

    expect(gateway.savedInputs, hasLength(1));
    expect(gateway.savedInputs.single.password, isNull);
    expect(gateway.storedPassword, _oldPassword);
  });

  testWidgets('更换账号或地址后留空密码必须重填，不触发保存或测试', (tester) async {
    final gateway = _FakeGateway()..seedSaved();
    await _pumpScreen(tester, _container(gateway));

    await _enter(tester, 'webdav-username', 'mallory');
    await _tap(tester, 'webdav-save');
    await tester.pumpAndSettle();
    expect(_boxText(tester, 'webdav-error'), contains('必须重新填写密码'));

    await _enter(tester, 'webdav-username', _savedUser);
    await _enter(tester, 'webdav-url', 'https://evil.example.com/dav');
    await _tap(tester, 'webdav-test');
    await tester.pumpAndSettle();
    expect(_boxText(tester, 'webdav-error'), contains('必须重新填写密码'));

    expect(gateway.savedInputs, isEmpty);
    expect(gateway.testedInputs, isEmpty);
  });

  testWidgets('地址包含账号密码时拒绝并提示改填输入框', (tester) async {
    final gateway = _FakeGateway();
    await _pumpScreen(tester, _container(gateway));

    await _enter(tester, 'webdav-url', 'https://bob:pw@dav.example.com/dav');
    await _enter(tester, 'webdav-username', 'bob');
    await _enter(tester, 'webdav-password', 'pw');
    await _tap(tester, 'webdav-test');
    await tester.pumpAndSettle();

    expect(_boxText(tester, 'webdav-error'), contains('不要包含账号或密码'));
    expect(gateway.testedInputs, isEmpty);
  });

  testWidgets('同步运行中禁止重复操作，完成后显示时间、未上传变更与警告', (tester) async {
    final gateway = _FakeGateway()..seedSaved();
    gateway.syncGate = Completer<WebDavSyncStatus>();
    await _pumpScreen(tester, _container(gateway));

    expect(_enabled(tester, 'webdav-sync'), isTrue);
    await _tap(tester, 'webdav-sync');
    expect(_enabled(tester, 'webdav-sync'), isFalse);
    expect(_enabled(tester, 'webdav-save'), isFalse);
    expect(_enabled(tester, 'webdav-test'), isFalse);
    expect(_enabled(tester, 'webdav-clear'), isFalse);
    await tester.tap(find.byKey(const Key('webdav-sync')), warnIfMissed: false);
    await tester.tap(find.byKey(const Key('webdav-save')), warnIfMissed: false);
    await tester.pump();
    expect(gateway.calls.where((c) => c == 'sync'), hasLength(1));
    expect(gateway.calls, isNot(contains('save')));

    gateway.syncGate!.complete(WebDavSyncStatus(
      lastSuccessAt: DateTime(2026, 10, 31, 20, 15, 30),
      pendingLocalChanges: 2,
      warnings: const ['设备 phone-x 的快照暂时无法读取'],
    ));
    await tester.pumpAndSettle();

    expect(find.text('最后成功同步：2026-10-31 20:15:30'), findsOneWidget);
    expect(find.text('未上传的本机变更：2'), findsOneWidget);
    expect(find.textContaining('phone-x'), findsOneWidget);
    expect(_boxText(tester, 'webdav-notice'), contains('需要注意'));
    expect(find.textContaining('本机变更均已上传'), findsNothing);
    expect(_enabled(tester, 'webdav-sync'), isTrue);
  });

  testWidgets('有未保存修改时禁止立即同步', (tester) async {
    final gateway = _FakeGateway()..seedSaved();
    await _pumpScreen(tester, _container(gateway));

    await _enter(tester, 'webdav-password', 'typed-but-unsaved');
    expect(_enabled(tester, 'webdav-sync'), isFalse);
    expect(find.textContaining('保存后才能立即同步'), findsOneWidget);
  });

  testWidgets('错误信息脱敏，不显示密码、Basic 凭据或 URL 中的账号', (tester) async {
    final gateway = _FakeGateway()..seedSaved();
    gateway.testError = Exception(
      '401 at https://alice:hunter2-pass@dav.example.com/dav '
      'password=hunter2-pass\nAuthorization: Basic YWxpY2U6aHVudGVy',
    );
    await _pumpScreen(tester, _container(gateway));

    await _enter(tester, 'webdav-password', 'hunter2-pass');
    await _tap(tester, 'webdav-test');
    await tester.pumpAndSettle();

    final message = _boxText(tester, 'webdav-error');
    expect(message, contains('401'));
    expect(message, isNot(contains('hunter2-pass')));
    expect(message, isNot(contains('YWxpY2U6aHVudGVy')));
    expect(message, isNot(contains('alice:')));
  });

  testWidgets('清除配置需确认，只清本机凭据，不触发保存或同步', (tester) async {
    final gateway = _FakeGateway()..seedSaved();
    await _pumpScreen(tester, _container(gateway));

    await _tap(tester, 'webdav-clear');
    await tester.pumpAndSettle();
    expect(find.textContaining('本地收藏与进度保留'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    expect(gateway.calls, isNot(contains('clear')));

    await _tap(tester, 'webdav-clear');
    await tester.pumpAndSettle();
    await tester.tap(find.text('清除'));
    await tester.pumpAndSettle();

    expect(gateway.calls, contains('clear'));
    expect(gateway.calls, isNot(contains('sync')));
    expect(gateway.calls, isNot(contains('save')));
    expect(gateway.storedPassword, isNull);
    expect(_field(tester, 'webdav-url').text, isEmpty);
    expect(_field(tester, 'webdav-username').text, isEmpty);
    expect(_boxText(tester, 'webdav-notice'), contains('远端文件均未删除'));
    expect(_enabled(tester, 'webdav-sync'), isFalse);
  });

  testWidgets('同步中离开页面后完成不抛异常，重新进入显示结果', (tester) async {
    final gateway = _FakeGateway()..seedSaved();
    gateway.syncGate = Completer<WebDavSyncStatus>();
    final container = _container(gateway);
    final showScreen = ValueNotifier(true);
    addTearDown(showScreen.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: ValueListenableBuilder<bool>(
            valueListenable: showScreen,
            builder: (context, show, _) =>
                show ? const WebDavSettingsScreen() : const Scaffold(body: Text('home')),
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pumpAndSettle();

    await _tap(tester, 'webdav-sync');
    showScreen.value = false;
    await tester.pump();
    expect(find.byType(WebDavSettingsScreen), findsNothing);

    gateway.syncGate!.complete(WebDavSyncStatus(
      lastSuccessAt: DateTime(2026, 10, 31, 21),
      pendingLocalChanges: 0,
    ));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(container.read(webDavSettingsProvider).isBusy, isFalse);
    expect(container.read(webDavSettingsProvider).status.lastSuccessAt, DateTime(2026, 10, 31, 21));

    showScreen.value = true;
    await tester.pump();
    await tester.pumpAndSettle();
    expect(find.text('最后成功同步：2026-10-31 21:00:00'), findsOneWidget);
    expect(_field(tester, 'webdav-url').text, _savedUrl);
  });

  testWidgets('小屏横屏且键盘弹出时无溢出，仍可滚动到同步按钮', (tester) async {
    tester.view.physicalSize = const Size(640, 320);
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = const FakeViewPadding(bottom: 140);
    addTearDown(tester.view.reset);
    final gateway = _FakeGateway()..seedSaved();
    await _pumpScreen(tester, _container(gateway));

    expect(tester.takeException(), isNull);
    await _tap(tester, 'webdav-sync');
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(gateway.calls, contains('sync'));
  });

  testWidgets('保存失败时给出明确提示而不是假成功', (tester) async {
    final gateway = _FakeGateway()..saveError = Exception('安全存储不可用');
    await _pumpScreen(tester, _container(gateway));

    await _enter(tester, 'webdav-url', _savedUrl);
    await _enter(tester, 'webdav-username', _savedUser);
    await _enter(tester, 'webdav-password', 'pw');
    await _tap(tester, 'webdav-save');
    await tester.pumpAndSettle();

    expect(_boxText(tester, 'webdav-error'), contains('安全存储不可用'));
    expect(find.byKey(const Key('webdav-notice')), findsNothing);
    expect(_enabled(tester, 'webdav-sync'), isFalse);
  });

  group('纯函数', () {
    test('脱敏会截断过长错误并隐藏 Bearer 令牌', () {
      final text = sanitizeWebDavError(Exception('Bearer abc.def ${'x' * 400}'));
      expect(text, isNot(contains('abc.def')));
      expect(text.length, lessThanOrEqualTo(201));
    });

    test('非 http(s) 协议与缺少主机名被拒绝', () {
      for (final url in ['ftp://dav.example.com', 'dav.example.com/dav', 'https://']) {
        expect(
          () => resolveWebDavForm(
            url: url,
            username: 'a',
            password: 'p',
            allowInsecureHttp: true,
            saved: null,
          ),
          throwsA(isA<WebDavFormException>()),
          reason: url,
        );
      }
    });
  });
}
