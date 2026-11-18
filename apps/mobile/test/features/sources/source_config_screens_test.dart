import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/kazumi/kazumi_providers.dart';
import 'package:titanhub/core/sources/market/market_infra.dart';
import 'package:titanhub/core/sources/unified/source_kind.dart';
import 'package:titanhub/core/sources/unified/unified_sources.dart';
import 'package:titanhub/core/sources/venera/venera_models.dart';
import 'package:titanhub/core/sources/venera/venera_providers.dart';
import 'package:titanhub/features/sources/source_config_screen.dart';
import 'package:titanhub/features/sources/source_hub_screen.dart';

import 'source_ui_support.dart';

VeneraSourcesState mangaState({bool showAdult = false, bool withCatalog = false}) => VeneraSourcesState(
      loaded: true,
      showAdult: showAdult,
      installed: [
        veneraItem('copy_manga', '拷贝漫画', hints: const VeneraConfigHints(hasSettings: true, hasAccount: true)),
        veneraItem('picacg', 'Picacg', enabled: false),
        veneraItem('komga', 'Komga', enabled: false),
        veneraItem('jm', '禁漫天堂', enabled: false),
        veneraItem('hitomi', 'hitomi.la', enabled: false),
        veneraItem('ykmh', '优酷漫画'),
      ],
    );

void main() {
  group('来源配置入口页', () {
    testWidgets('列出四类入口，小说与影视为灰态“即将支持”，不出现引擎名', (tester) async {
      await pumpScreen(tester, const SourceHubScreen(),
          kazumi: KazumiSourcesState(loaded: true, installed: [kazumiItem('AGE')]), venera: mangaState());
      expect(find.text('动漫源配置'), findsOneWidget);
      expect(find.text('漫画源配置'), findsOneWidget);
      expect(find.text('小说源配置'), findsOneWidget);
      expect(find.text('影视源配置'), findsOneWidget);
      expect(find.text('即将支持'), findsNWidgets(2));
      expect(find.text('已安装 1 个 · 已启用 1 个'), findsOneWidget);
      expect(find.text('已安装 6 个 · 已启用 2 个'), findsOneWidget);
      expect(find.textContaining('Kazumi'), findsNothing);
      expect(find.textContaining('Venera'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('小说与影视不可点击，动漫与漫画可进入配置页', (tester) async {
      await pumpScreen(tester, const SourceHubScreen(), route: '/sources');
      await tester.tap(find.byKey(const Key('source-kind-novel')));
      await tester.pumpAndSettle();
      expect(find.text('进入配置页'), findsNothing);
      await tester.tap(find.byKey(const Key('source-kind-movie')));
      await tester.pumpAndSettle();
      expect(find.text('进入配置页'), findsNothing);
      expect(find.byType(SourceHubScreen), findsOneWidget);
      await tester.tap(find.byKey(const Key('source-kind-manga')));
      await tester.pumpAndSettle();
      expect(find.text('进入配置页'), findsOneWidget);
    });

    for (final size in [const Size(320, 568), const Size(390, 844)]) {
      for (final brightness in Brightness.values) {
        testWidgets('入口页在 ${size.width.toInt()} 宽、$brightness 下无溢出', (tester) async {
          await pumpScreen(tester, const SourceHubScreen(), size: size, brightness: brightness);
          expect(tester.takeException(), isNull);
          expect(find.text('来源配置'), findsOneWidget);
          expect(find.text('即将支持'), findsNWidgets(2));
        });
      }
    }
  });

  group('漫画源配置页', () {
    testWidgets('来源列表显示名称、版本、状态与标签，成人向默认隐藏', (tester) async {
      await pumpScreen(tester, const SourceConfigScreen(kind: SourceKind.manga), venera: mangaState());
      expect(find.text('漫画源配置'), findsOneWidget);
      expect(find.text('拷贝漫画'), findsOneWidget);
      expect(find.text('v1.2.0 · 已启用'), findsNWidgets(2));
      expect(find.byKey(const Key('source-status-venera-picacg')), findsOneWidget);
      expect(find.text('v1.2.0 · 已停用'), findsNWidgets(2));
      expect(find.text('需登录'), findsOneWidget);
      expect(find.text('需配置'), findsOneWidget);
      expect(find.text('实验兼容'), findsNWidgets(4));
      expect(find.text('禁漫天堂'), findsNothing);
      expect(find.text('hitomi.la'), findsNothing);
      expect(find.byKey(const Key('source-adult-section')), findsNothing);
      expect(find.textContaining('Kazumi'), findsNothing);
      expect(find.textContaining('Venera'), findsNothing);
    });

    testWidgets('打开“显示成人向来源”后出现单独分区，成人向标签可见', (tester) async {
      final container = await pumpScreen(tester, const SourceConfigScreen(kind: SourceKind.manga), venera: mangaState());
      await tester.tap(find.byKey(const Key('source-show-adult')));
      await tester.pumpAndSettle();
      expect(calls, contains('manga:showAdult:true'));
      expect(container.read(unifiedKindViewProvider(SourceKind.manga)).showAdult, isTrue);
      expect(find.byKey(const Key('source-adult-section')), findsOneWidget);
      expect(find.text('禁漫天堂'), findsOneWidget);
      expect(find.text('成人向'), findsNWidgets(2));
    });

    testWidgets('启用成人向来源必须先确认，取消则不启用', (tester) async {
      await pumpScreen(tester, const SourceConfigScreen(kind: SourceKind.manga), venera: mangaState(showAdult: true));
      await tester.ensureVisible(find.byKey(const Key('source-switch-venera-jm')));
      await tester.tap(find.byKey(const Key('source-switch-venera-jm')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('adult-confirm')), findsOneWidget);
      expect(calls.where((c) => c.startsWith('manga:enable')), isEmpty);
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(calls.where((c) => c.startsWith('manga:enable')), isEmpty);

      await tester.tap(find.byKey(const Key('source-switch-venera-jm')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('adult-confirm-ok')));
      await tester.pumpAndSettle();
      expect(calls, contains('manga:enable:venera-jm:true'));
    });

    testWidgets('普通来源启停无需确认，停用与卸载直接生效', (tester) async {
      await pumpScreen(tester, const SourceConfigScreen(kind: SourceKind.manga), venera: mangaState());
      await tester.tap(find.byKey(const Key('source-switch-venera-picacg')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('adult-confirm')), findsNothing);
      expect(calls, contains('manga:enable:venera-picacg:true'));
      await tester.tap(find.byKey(const Key('source-switch-venera-ykmh')));
      await tester.pumpAndSettle();
      expect(calls, contains('manga:enable:venera-ykmh:false'));
      await tester.tap(find.byKey(const Key('source-uninstall-venera-picacg')));
      await tester.pumpAndSettle();
      expect(calls, contains('manga:uninstall:venera-picacg'));
    });

    testWidgets('声明了设置或账号的来源提供“设置/登录”入口', (tester) async {
      await pumpScreen(tester, const SourceConfigScreen(kind: SourceKind.manga), venera: mangaState());
      expect(find.byKey(const Key('source-settings-venera-copy_manga')), findsOneWidget);
      expect(find.byKey(const Key('source-settings-venera-ykmh')), findsNothing);
      await tester.tap(find.byKey(const Key('source-settings-venera-copy_manga')));
      await tester.pumpAndSettle();
      expect(find.text('进入设置页 venera-copy_manga'), findsOneWidget);
    });

    testWidgets('一键安装、检查更新、全部更新分别触发对应操作', (tester) async {
      await pumpScreen(tester, const SourceConfigScreen(kind: SourceKind.manga), venera: mangaState());
      await tester.tap(find.byKey(const Key('source-install-recommended')));
      await tester.tap(find.byKey(const Key('source-check-updates')));
      await tester.tap(find.byKey(const Key('source-update-all')));
      await tester.pump();
      expect(calls, ['manga:installRecommended', 'manga:refreshCatalog', 'manga:updateInstalled']);
    });

    testWidgets('安装结果与失败原因汇总展示', (tester) async {
      await pumpScreen(
        tester,
        const SourceConfigScreen(kind: SourceKind.manga),
        venera: VeneraSourcesState(loaded: true, lastReport: sampleReport()),
      );
      expect(find.byKey(const Key('source-report')), findsOneWidget);
      expect(find.textContaining('新装 1'), findsOneWidget);
      expect(find.textContaining('失败 1'), findsOneWidget);
      expect(find.text('乙 失败：所有镜像均失败（超时）'), findsOneWidget);
      expect(find.textContaining('内置快照'), findsWidgets);
    });

    testWidgets('忙碌时显示进度并禁用操作按钮', (tester) async {
      await pumpScreen(
        tester,
        const SourceConfigScreen(kind: SourceKind.manga),
        venera: VeneraSourcesState(loaded: true, busy: true, busyMessage: '正在安装推荐来源', installed: mangaState().installed),
        settle: false,
      );
      expect(find.text('正在安装推荐来源'), findsOneWidget);
      expect(find.byKey(const Key('source-install-recommended')), findsNothing);
      final switchWidget = tester.widget<Switch>(find.byKey(const Key('source-switch-venera-ykmh')));
      expect(switchWidget.onChanged, isNull);
    });

    testWidgets('目录地址：保存与恢复默认', (tester) async {
      await pumpScreen(tester, const SourceConfigScreen(kind: SourceKind.manga), venera: mangaState());
      await tester.enterText(find.byKey(const Key('source-catalog-url')), 'https://cdn.test/cfg/');
      await tester.ensureVisible(find.byKey(const Key('source-catalog-save')));
      await tester.tap(find.byKey(const Key('source-catalog-save')));
      await tester.tap(find.byKey(const Key('source-catalog-reset')));
      await tester.pump();
      expect(calls, ['manga:catalogUrl:https://cdn.test/cfg/', 'manga:catalogUrl:']);
    });

    testWidgets('导入订阅：非 HTTPS 显示错误，不触发安装', (tester) async {
      await pumpScreen(tester, const SourceConfigScreen(kind: SourceKind.manga), venera: mangaState());
      await tester.enterText(find.byKey(const Key('source-import-url')), 'http://x.test/');
      await tester.tap(find.byKey(const Key('source-import')));
      await tester.pumpAndSettle();
      expect(find.textContaining('必须是 HTTPS'), findsOneWidget);
      expect(calls, isEmpty);
    });

    testWidgets('导入订阅：格式无法识别时明确报错', (tester) async {
      await pumpScreen(
        tester,
        const SourceConfigScreen(kind: SourceKind.manga),
        venera: mangaState(),
        overrides: [
          subscriptionFetcherProvider.overrideWithValue(
            MirrorFetcher(httpGet: (url, max) async => utf8.encode('{"a":1}')),
          ),
        ],
      );
      await tester.enterText(find.byKey(const Key('source-import-url')), 'https://x.test/list/');
      await tester.tap(find.byKey(const Key('source-import')));
      await tester.pumpAndSettle();
      expect(find.textContaining('无法识别订阅格式'), findsOneWidget);
      expect(calls, isEmpty);
    });

    testWidgets('导入订阅：识别脚本目录后触发安装并清空输入', (tester) async {
      final index = jsonEncode([
        {'name': '拷贝漫画', 'key': 'copy_manga', 'fileName': 'copy_manga.js', 'version': '1.0.0'},
      ]);
      await pumpScreen(
        tester,
        const SourceConfigScreen(kind: SourceKind.manga),
        venera: mangaState(),
        overrides: [
          subscriptionFetcherProvider.overrideWithValue(
            MirrorFetcher(httpGet: (url, max) async => utf8.encode(index)),
          ),
        ],
      );
      await tester.enterText(find.byKey(const Key('source-import-url')), 'https://x.test/list/');
      await tester.tap(find.byKey(const Key('source-import')));
      await tester.pumpAndSettle();
      expect(calls, ['manga:installFrom:1']);
      expect(find.text('https://x.test/list/'), findsNothing);
    });

    for (final size in [const Size(320, 568), const Size(390, 844)]) {
      for (final brightness in Brightness.values) {
        testWidgets('配置页在 ${size.width.toInt()} 宽、$brightness 下无溢出', (tester) async {
          await pumpScreen(
            tester,
            const SourceConfigScreen(kind: SourceKind.manga),
            venera: VeneraSourcesState(
              loaded: true,
              showAdult: true,
              installed: mangaState().installed,
              lastReport: sampleReport(),
              error: '一个很长的错误信息用来检查小屏幕下的换行表现，不应该发生溢出',
            ),
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
  });

  group('动漫源配置页', () {
    testWidgets('不显示成人向开关；操作分发到对应引擎', (tester) async {
      await pumpScreen(
        tester,
        const SourceConfigScreen(kind: SourceKind.anime),
        kazumi: KazumiSourcesState(loaded: true, installed: [kazumiItem('AGE'), kazumiItem('aafun', enabled: false)]),
      );
      expect(find.text('动漫源配置'), findsOneWidget);
      expect(find.byKey(const Key('source-show-adult')), findsNothing);
      expect(find.text('AGE'), findsOneWidget);
      expect(find.text('v1.0 · 已启用'), findsOneWidget);
      expect(find.text('v1.0 · 已停用'), findsOneWidget);
      expect(find.byKey(const Key('source-settings-kazumi-age')), findsNothing);
      await tester.tap(find.byKey(const Key('source-install-recommended')));
      await tester.tap(find.byKey(const Key('source-switch-kazumi-aafun')));
      await tester.pump();
      expect(calls, ['anime:installAll', 'anime:enable:kazumi-aafun:true']);
    });

    testWidgets('空列表给出引导文案', (tester) async {
      await pumpScreen(tester, const SourceConfigScreen(kind: SourceKind.anime));
      expect(find.textContaining('尚未安装任何来源'), findsOneWidget);
    });
  });
}
