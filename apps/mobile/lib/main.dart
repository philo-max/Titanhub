import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:media_kit/media_kit.dart';
import 'core/network/mainland_channel.dart';
import 'core/router/app_router.dart';
import 'core/sources/kazumi/kazumi_providers.dart';
import 'core/sources/local_sources.dart';
import 'core/sources/venera/venera_providers.dart';
import 'core/theme/app_theme.dart';

Future<void> main() async {
  // Ensure Flutter engine and native bindings are fully initialized before startup
  WidgetsFlutterBinding.ensureInitialized();

  // Start local DoH CONNECT proxy to bypass Mainland ISP DNS poisoning (e.g. api.bgm.tv / lain.bgm.tv)
  await MainlandDohProxy.instance.start();
  HttpOverrides.global = MainlandHttpOverrides();

  // Initialize MediaKit native libraries (libmpv backend)
  MediaKit.ensureInitialized();
  
  runApp(
    const ProviderScope(
      child: TitanhubApp(),
    ),
  );
}

class TitanhubApp extends ConsumerWidget {
  const TitanhubApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    ref.watch(kazumiBootstrapProvider);
    ref.watch(veneraBootstrapProvider);
    ref.watch(novelBootstrapProvider);

    return MaterialApp.router(
      title: 'Titanhub',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: AppTheme.background,
        colorScheme: const ColorScheme.dark(
          primary: AppTheme.primary,
          secondary: AppTheme.secondary,
          surface: AppTheme.surface,
          background: AppTheme.background,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: AppTheme.surface,
          foregroundColor: AppTheme.textPrimary,
          elevation: 0,
        ),
        cardTheme: CardThemeData(
          color: AppTheme.surface,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppTheme.radiusLG),
            side: const BorderSide(color: AppTheme.border, width: 1),
          ),
          elevation: 0,
        ),
      ),
      routerConfig: router,
    );
  }
}
