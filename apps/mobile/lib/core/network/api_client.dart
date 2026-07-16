import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

// StateNotifier to manage and persist the server URL dynamically
class ServerUrlNotifier extends StateNotifier<String> {
  ServerUrlNotifier() : super(_getDefaultUrl()) {
    _loadPersistedUrl();
  }

  static String _getDefaultUrl() {
    if (!kIsWeb && Platform.isAndroid) {
      return 'http://10.0.2.2:3001';
    }
    return 'http://localhost:3001';
  }

  Future<void> _loadPersistedUrl() async {
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/server_url.txt');
      if (await file.exists()) {
        final saved = await file.readAsString();
        if (saved.trim().isNotEmpty) {
          state = saved.trim();
        }
      }
    } catch (_) {}
  }

  Future<void> updateUrl(String newUrl) async {
    state = newUrl.trim();
    try {
      final dir = await getApplicationDocumentsDirectory();
      final file = File('${dir.path}/server_url.txt');
      await file.writeAsString(state);
    } catch (_) {}
  }
}

final serverUrlProvider = StateNotifierProvider<ServerUrlNotifier, String>((ref) {
  return ServerUrlNotifier();
});

final apiClientProvider = Provider<Dio>((ref) {
  final dio = Dio();
  final baseUrl = ref.watch(serverUrlProvider);

  dio.options = BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 10),
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  );

  return dio;
});
