import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/venera/venera_source.dart';
import 'package:titanhub/features/sources/source_settings_screen.dart';

import 'source_ui_support.dart';

const _id = 'venera-fixture';

VeneraSettingItem input() => const VeneraSettingItem(
      key: 'domain',
      title: '域名',
      type: 'input',
      defaultValue: 'https://a.test',
      value: 'https://a.test',
    );

VeneraSettingItem select() => const VeneraSettingItem(
      key: 'quality',
      title: '画质',
      type: 'select',
      defaultValue: 'hd',
      value: 'hd',
      options: [VeneraSettingOption(value: 'hd', text: '高清'), VeneraSettingOption(value: 'sd', text: '标清')],
    );

VeneraSettingItem toggle() => const VeneraSettingItem(
      key: 'safe',
      title: '安全模式',
      type: 'switch',
      defaultValue: false,
      value: false,
    );

VeneraSettingItem callback() => const VeneraSettingItem(
      key: 'cb',
      title: '回调项',
      type: 'callback',
      defaultValue: null,
      value: null,
    );

Future<FakeVeneraSource> pump(
  WidgetTester tester,
  VeneraSourceInfo info, {
  Size size = const Size(390, 2400),
  Brightness brightness = Brightness.dark,
}) async {
  final source = FakeVeneraSource(info);
  await pumpScreen(
    tester,
    const SourceSettingsScreen(pluginId: _id),
    overrides: [settingsSourceProvider(_id).overrideWithValue(source)],
    size: size,
    brightness: brightness,
  );
  return source;
}

void main() {
  testWidgets('input、select、switch 三类设置项可编辑并一起保存', (tester) async {
    final source = await pump(tester, infoOf(settings: [input(), select(), toggle()]));
    final save = find.byKey(const Key('settings-save'));
    expect(tester.widget<FilledButton>(save).onPressed, isNull);

    await tester.enterText(find.byKey(const Key('setting-domain')), 'https://b.test');
    await tester.tap(find.byKey(const Key('setting-safe')));
    await tester.tap(find.byKey(const Key('setting-quality')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('标清').last);
    await tester.pumpAndSettle();
    await tester.tap(save);
    await tester.pumpAndSettle();

    expect(source.saved, {'domain': 'https://b.test', 'safe': true, 'quality': 'sd'});
    expect(find.text('设置已保存'), findsOneWidget);
  });

  testWidgets('其他类型的设置项明确提示暂不支持，且不产生可编辑控件', (tester) async {
    await pump(tester, infoOf(settings: [callback()]));
    expect(find.byKey(const Key('setting-unsupported-cb')), findsOneWidget);
    expect(find.textContaining('暂不支持'), findsOneWidget);
    expect(find.byKey(const Key('setting-cb')), findsNothing);
  });

  testWidgets('账号密码登录：密码输入框遮蔽，提交调用来源登录', (tester) async {
    final source = await pump(tester, infoOf(canPasswordLogin: true));
    final password = tester.widget<TextField>(find.byKey(const Key('login-password')));
    expect(password.obscureText, isTrue);
    await tester.enterText(find.byKey(const Key('login-account')), ' alice ');
    await tester.enterText(find.byKey(const Key('login-password')), 'hunter2');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(calls, ['login:alice:hunter2']);
    expect(find.text('登录成功'), findsOneWidget);
    expect(source, isNotNull);
  });

  testWidgets('登录失败显示原因且错误信息不含口令', (tester) async {
    final source = await pump(tester, infoOf(canPasswordLogin: true));
    source.loginError = 'Login failed: 401';
    await tester.enterText(find.byKey(const Key('login-account')), 'alice');
    await tester.enterText(find.byKey(const Key('login-password')), 'bad');
    await tester.tap(find.byKey(const Key('login-submit')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Login failed: 401'), findsOneWidget);
    expect(find.textContaining('bad'), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const Key('login-password'))).obscureText, isTrue);
  });

  testWidgets('已登录显示状态并可退出', (tester) async {
    await pump(tester, infoOf(canPasswordLogin: true, isLogged: true));
    expect(find.byKey(const Key('login-state')), findsOneWidget);
    expect(find.byKey(const Key('login-password')), findsNothing);
    await tester.tap(find.byKey(const Key('login-logout')));
    await tester.pumpAndSettle();
    expect(calls, ['logout']);
  });

  testWidgets('网页登录、Cookie 登录来源明确提示不支持，且无账号表单', (tester) async {
    await pump(tester, infoOf(hasWebLogin: true, hasCookieLogin: true));
    expect(find.byKey(const Key('login-unsupported')), findsOneWidget);
    expect(find.textContaining('手机端暂不支持'), findsOneWidget);
    expect(find.byKey(const Key('login-account')), findsNothing);
  });

  testWidgets('既有密码登录又有网页登录时仍提示其余方式不支持', (tester) async {
    await pump(tester, infoOf(canPasswordLogin: true, hasWebLogin: true));
    expect(find.byKey(const Key('login-account')), findsOneWidget);
    expect(find.byKey(const Key('login-unsupported')), findsOneWidget);
  });

  testWidgets('无可配置项时明确说明', (tester) async {
    await pump(tester, infoOf());
    expect(find.text('这个来源没有可配置的设置项。'), findsOneWidget);
  });

  testWidgets('来源不可用时显示错误而不是崩溃', (tester) async {
    await pumpScreen(tester, const SourceSettingsScreen(pluginId: 'venera-missing'));
    expect(find.textContaining('无法读取来源设置'), findsOneWidget);
  });

  testWidgets('支持 registerWebsite 的来源显示去注册与复制网址按钮，忽略非法 scheme', (tester) async {
    await pump(tester, infoOf(canPasswordLogin: true, registerWebsite: 'https://example.com/register'));
    expect(find.byKey(const Key('login-register-url')), findsOneWidget);
    expect(find.byKey(const Key('login-register-open')), findsOneWidget);
    expect(find.byKey(const Key('login-register-copy')), findsOneWidget);

    await pump(tester, infoOf(canPasswordLogin: true, registerWebsite: 'javascript:alert(1)'));
    expect(find.byKey(const Key('login-register-url')), findsNothing);
    expect(find.byKey(const Key('login-register-open')), findsNothing);
  });

  for (final size in [const Size(320, 568), const Size(390, 844)]) {
    for (final brightness in Brightness.values) {
      testWidgets('设置页在 ${size.width.toInt()} 宽、$brightness 下无溢出', (tester) async {
        await pump(
          tester,
          infoOf(settings: [input(), select(), toggle(), callback()], canPasswordLogin: true, hasWebLogin: true),
          size: size,
          brightness: brightness,
        );
        expect(tester.takeException(), isNull);
        await tester.drag(find.byType(ListView), const Offset(0, -2000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  }
}
