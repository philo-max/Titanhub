import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:media_kit/media_kit.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

void main() {
  // Ensure Flutter engine and native bindings are fully initialized before startup
  WidgetsFlutterBinding.ensureInitialized();
  
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

    return MaterialApp.router(
      title: 'Titanhub',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
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
        cardTheme: CardTheme(
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
