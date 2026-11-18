import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_models.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_providers.dart';
import 'package:titanhub/core/sources/market/market_infra.dart';
import 'package:titanhub/core/sources/venera/venera_models.dart';
import 'package:titanhub/core/sources/venera/venera_providers.dart';
import 'package:titanhub/core/sources/venera/venera_source.dart';
import 'package:titanhub/core/sources/venera/venera_store.dart';

final calls = <String>[];

InstalledKazumiSource kazumiItem(String name, {bool enabled = true}) => InstalledKazumiSource(
      id: 'kazumi-${name.toLowerCase()}',
      name: name,
      version: '1.0',
      type: 'anime',
      downloadUrl: '',
      catalogUrl: '',
      enabled: enabled,
      installedAt: DateTime.utc(2024),
      updatedAt: DateTime.utc(2024),
    );

InstalledVeneraSource veneraItem(
  String key,
  String name, {
  bool enabled = true,
  VeneraConfigHints hints = const VeneraConfigHints(),
}) =>
    InstalledVeneraSource(
      id: 'venera-$key',
      key: key,
      name: name,
      version: '1.2.0',
      fileName: '$key.js',
      downloadUrl: '',
      catalogUrl: '',
      enabled: enabled,
      installedAt: DateTime.utc(2024),
      updatedAt: DateTime.utc(2024),
      hints: hints,
    );

class FakeKazumiNotifier extends KazumiSourcesNotifier {
  FakeKazumiNotifier(super.ref, KazumiSourcesState initial) {
    state = initial;
  }

  @override
  Future<void> installAll() async => calls.add('anime:installAll');
  @override
  Future<void> refreshCatalog() async => calls.add('anime:refreshCatalog');
  @override
  Future<void> updateInstalled() async => calls.add('anime:updateInstalled');
  @override
  Future<void> installOne(String id) async => calls.add('anime:install:$id');
  @override
  Future<void> setEnabled(String id, bool enabled) async => calls.add('anime:enable:$id:$enabled');
  @override
  Future<void> uninstall(String id) async => calls.add('anime:uninstall:$id');
  @override
  Future<void> setCatalogUrl(String input) async => calls.add('anime:catalogUrl:$input');
  @override
  Future<void> installFrom(catalog) async => calls.add('anime:installFrom:${catalog.entries.length}');
}

class FakeVeneraNotifier extends VeneraSourcesNotifier {
  FakeVeneraNotifier(super.ref, VeneraSourcesState initial) {
    state = initial;
  }

  @override
  Future<void> installRecommended() async => calls.add('manga:installRecommended');
  @override
  Future<void> refreshCatalog() async => calls.add('manga:refreshCatalog');
  @override
  Future<void> updateInstalled() async => calls.add('manga:updateInstalled');
  @override
  Future<void> installOne(String id) async => calls.add('manga:install:$id');
  @override
  Future<void> setEnabled(String id, bool enabled) async => calls.add('manga:enable:$id:$enabled');
  @override
  Future<void> uninstall(String id) async => calls.add('manga:uninstall:$id');
  @override
  Future<void> setShowAdult(bool value) async {
    calls.add('manga:showAdult:$value');
    state = state.copyWith(showAdult: value);
  }

  @override
  Future<void> setCatalogUrl(String input) async => calls.add('manga:catalogUrl:$input');
  @override
  Future<void> installFrom(catalog) async => calls.add('manga:installFrom:${catalog.entries.length}');
}

class FakeVeneraSource extends VeneraSource {
  FakeVeneraSource(this.fakeInfo)
      : super(veneraItem('fixture', '夹具'), '', store: VeneraStore(Directory.systemTemp));

  VeneraSourceInfo fakeInfo;
  final saved = <String, Object?>{};
  String? loginError;

  @override
  Future<VeneraSourceInfo> info() async => fakeInfo;

  @override
  Future<void> saveSetting(String key, Object? value) async => saved[key] = value;

  @override
  Future<void> login(String account, String password) async {
    calls.add('login:$account:$password');
    if (loginError != null) throw VeneraException(loginError!);
  }

  @override
  Future<void> logout() async => calls.add('logout');
}

VeneraSourceInfo infoOf({
  List<VeneraSettingItem> settings = const [],
  bool canPasswordLogin = false,
  bool hasWebLogin = false,
  bool hasCookieLogin = false,
  bool isLogged = false,
}) =>
    VeneraSourceInfo(
      hasSearch: true,
      exploreTitles: const [],
      settings: settings,
      canPasswordLogin: canPasswordLogin,
      hasWebLogin: hasWebLogin,
      hasCookieLogin: hasCookieLogin,
      isLogged: isLogged,
      registerWebsite: '',
    );

Future<ProviderContainer> pumpScreen(
  WidgetTester tester,
  Widget screen, {
  KazumiSourcesState kazumi = const KazumiSourcesState(loaded: true),
  VeneraSourcesState venera = const VeneraSourcesState(loaded: true),
  List<Override> overrides = const [],
  Size size = const Size(390, 2400),
  Brightness brightness = Brightness.dark,
  String route = '/',
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  calls.clear();
  final container = ProviderContainer(overrides: [
    kazumiSourcesProvider.overrideWith((ref) => FakeKazumiNotifier(ref, kazumi)),
    veneraSourcesProvider.overrideWith((ref) => FakeVeneraNotifier(ref, venera)),
    ...overrides,
  ]);
  addTearDown(container.dispose);
  final router = GoRouter(
    initialLocation: route,
    routes: [
      GoRoute(path: '/', builder: (context, state) => screen),
      GoRoute(path: '/sources', builder: (context, state) => screen),
      GoRoute(path: '/sources/:kind', builder: (context, state) => const Scaffold(body: Text('进入配置页'))),
      GoRoute(
        path: '/sources/:kind/:pluginId/settings',
        builder: (context, state) => Scaffold(body: Text('进入设置页 ${state.pathParameters['pluginId']}')),
      ),
    ],
  );
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: MaterialApp.router(
      routerConfig: router,
      theme: brightness == Brightness.dark ? ThemeData.dark() : ThemeData.light(),
    ),
  ));
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
  }
  return container;
}

MarketInstallReport sampleReport() => const MarketInstallReport(
      items: [
        MarketInstallItem(id: 'venera-a', name: '甲', status: MarketInstallStatus.installed),
        MarketInstallItem(id: 'venera-b', name: '乙', status: MarketInstallStatus.failed, message: '所有镜像均失败（超时）'),
      ],
      catalogOrigin: 'snapshot',
      catalogWarnings: ['在线目录不可用，已改用内置快照：超时'],
    );
