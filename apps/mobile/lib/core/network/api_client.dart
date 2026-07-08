import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final apiClientProvider = Provider<Dio>((ref) {
  final dio = Dio();
  
  // Choose correct base URL for localhost routing:
  // Android emulator uses 10.0.2.2 to access the host machine's localhost.
  // iOS simulator and Desktop (macOS, Windows) use localhost directly.
  String baseUrl = 'http://localhost:3001';
  if (!kIsWeb && Platform.isAndroid) {
    baseUrl = 'http://10.0.2.2:3001';
  }

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
