import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:titanhub/core/sandbox/js_engine.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  test('MangaDex native search, detail, chapters and first image', () async {
    final engine = JsEngine();
    final dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 30),
    ));
    try {
      await engine.loadPlugin(
        await rootBundle.loadString('assets/plugins/mangadex.js'),
      );
      final results = await engine.callPluginMethod('search', ['Yotsuba']);
      expect(results, isA<List>());
      expect(results, isNotEmpty);
      final id = results.first['id'] as String;
      final detail = await engine.callPluginMethod('getDetail', [id]);
      expect(detail['title'], isNotEmpty);
      final chapters = await engine.callPluginMethod('getChapters', [id]);
      expect(chapters, isNotEmpty);
      final images = await engine.callPluginMethod('getImages', [chapters.first['id']]);
      expect(images, isNotEmpty);
      final image = Uri.parse(images.first as String);
      expect(image.scheme, 'https');
      final response = await dio.get<List<int>>(
        image.toString(),
        options: Options(responseType: ResponseType.bytes),
      );
      expect(response.statusCode, 200);
      expect(response.data!.length, greaterThan(100));
      print('LIVE_SOURCE_OK results=${results.length} chapters=${chapters.length} images=${images.length} bytes=${response.data!.length}');
    } finally {
      dio.close(force: true);
      engine.dispose();
    }
  }, skip: !const bool.fromEnvironment('TITANHUB_LIVE_CHECK'), timeout: const Timeout(Duration(minutes: 3)));
}
