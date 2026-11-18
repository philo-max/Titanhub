import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/network/api_client.dart';
import 'package:titanhub/core/sandbox/local_plugin_runner.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/core/sources/media_source.dart';
import 'package:titanhub/features/media/providers/media_providers.dart';

const _sources = [
  MediaSource(id: 'anime-a', name: '动漫A', types: ['anime'],
      capabilities: {MediaCapability.search}),
  MediaSource(id: 'manga-a', name: '漫画A', types: ['manga'],
      capabilities: {MediaCapability.search}),
];

class _RecordingRunner extends LocalPluginRunner {
  final calls = <String>[];
  final gates = <String, Completer<void>>{};
  final failing = <String>{};

  @override
  Future<dynamic> call(String pluginId, String method, List<dynamic> args) async {
    calls.add(pluginId);
    await gates[pluginId]?.future;
    if (failing.contains(pluginId)) throw StateError('$pluginId 网络不可用');
    return [
      {'id': '$pluginId-1', 'title': '${args.first}@$pluginId', 'cover': ''},
    ];
  }
}

class _FakeServer {
  final requests = <RequestOptions>[];
  Object? error;

  Dio dio() {
    final dio = Dio();
    dio.interceptors.add(InterceptorsWrapper(onRequest: (options, handler) {
      requests.add(options);
      if (error != null) {
        handler.reject(DioException(requestOptions: options, error: error));
        return;
      }
      handler.resolve(Response(requestOptions: options, statusCode: 200, data: {
        'items': [
          {
            'id': 'group',
            'title': '远端结果',
            'cover': 'https://img.test/c.jpg',
            'mediaType': options.queryParameters['type'] ?? 'anime',
            'sources': [
              {'pluginId': 'server-only', 'pluginName': '服务器来源', 'mediaId': 'r-1'},
              {'pluginId': 'manga-a', 'pluginName': '漫画A', 'mediaId': 'r-2'},
            ],
          },
        ],
      }));
    }));
    return dio;
  }
}

ProviderContainer _container(_RecordingRunner runner, {_FakeServer? server}) {
  return ProviderContainer(overrides: [
    localSourcesProvider.overrideWithValue(_sources),
    enabledSourceIdsProvider.overrideWith((ref) => {for (final s in _sources) s.id}),
    localPluginRunnerProvider.overrideWithValue(runner),
    if (server != null) apiClientProvider.overrideWithValue(server.dio()),
  ]);
}

void main() {
  test('全部分类搜索全部启用来源', () async {
    final runner = _RecordingRunner();
    final container = _container(runner);
    addTearDown(container.dispose);
    final outcome = await container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.all)).future);
    expect(runner.calls, unorderedEquals(['anime-a', 'manga-a']));
    expect(outcome.items.map((i) => i.pluginId), unorderedEquals(['anime-a', 'manga-a']));
    expect(outcome.searchedSources, 2);
  });

  test('选择漫画只请求漫画来源', () async {
    final runner = _RecordingRunner();
    final container = _container(runner);
    addTearDown(container.dispose);
    final outcome = await container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.manga)).future);
    expect(runner.calls, ['manga-a']);
    expect(outcome.items.single.pluginId, 'manga-a');
    expect(outcome.items.single.title, '海贼@manga-a');
  });

  test('分类没有来源时明确提示且不请求任何来源', () async {
    final runner = _RecordingRunner();
    final container = _container(runner);
    addTearDown(container.dispose);
    final outcome = await container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.novel)).future);
    expect(runner.calls, isEmpty);
    expect(outcome.items, isEmpty);
    expect(outcome.searchedSources, 0);
    expect(outcome.failures.values.single, contains('小说'));
  });

  test('来源失败记录原因而不伪造结果', () async {
    final runner = _RecordingRunner()..failing.add('anime-a');
    final container = _container(runner);
    addTearDown(container.dispose);
    final outcome = await container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.anime)).future);
    expect(outcome.items, isEmpty);
    expect(outcome.failures['动漫A'], contains('网络不可用'));
  });

  test('切换分类后旧请求结果不混入新分类', () async {
    final runner = _RecordingRunner()..gates['anime-a'] = Completer<void>();
    final container = _container(runner);
    addTearDown(container.dispose);
    final animeFuture = container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.anime)).future);
    final manga = await container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.manga)).future);
    runner.gates['anime-a']!.complete();
    final anime = await animeFuture;
    expect(manga.items.map((i) => i.pluginId), ['manga-a']);
    expect(anime.items.map((i) => i.pluginId), ['anime-a']);
    final mangaAgain = await container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.manga)).future);
    expect(mangaAgain.items.map((i) => i.pluginId), ['manga-a']);
  });

  test('远端关闭时不访问服务器', () async {
    final runner = _RecordingRunner();
    final server = _FakeServer();
    final container = _container(runner, server: server);
    addTearDown(container.dispose);
    await container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.movie)).future);
    expect(server.requests, isEmpty);
  });

  test('本机无结果时远端回退携带分类 type 参数', () async {
    final runner = _RecordingRunner();
    final server = _FakeServer();
    final container = _container(runner, server: server);
    addTearDown(container.dispose);
    container.read(remoteEnabledProvider.notifier).state = true;
    final outcome = await container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.movie)).future);
    final request = server.requests.single;
    expect(request.path, '/api/aggregate/search');
    expect(request.queryParameters, {'q': '海贼', 'type': 'movie'});
    expect(outcome.remoteRequested, isTrue);
    expect(outcome.items.single.title, '远端结果');
    expect(outcome.items.single.pluginId, 'manga-a');
    expect(outcome.items.single.id, 'r-2');
  });

  test('全部分类远端回退不传 type', () async {
    final runner = _RecordingRunner()..failing.addAll(['anime-a', 'manga-a']);
    final server = _FakeServer();
    final container = _container(runner, server: server);
    addTearDown(container.dispose);
    container.read(remoteEnabledProvider.notifier).state = true;
    await container.read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.all)).future);
    expect(server.requests.single.queryParameters, {'q': '海贼'});
  });

  test('本机有结果时不触发远端回退', () async {
    final runner = _RecordingRunner();
    final server = _FakeServer();
    final container = _container(runner, server: server);
    addTearDown(container.dispose);
    container.read(remoteEnabledProvider.notifier).state = true;
    await container.read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.manga)).future);
    expect(server.requests, isEmpty);
  });

  test('远端回退失败时记录服务器错误', () async {
    final runner = _RecordingRunner();
    final server = _FakeServer()..error = StateError('连接被拒绝');
    final container = _container(runner, server: server);
    addTearDown(container.dispose);
    container.read(remoteEnabledProvider.notifier).state = true;
    final outcome = await container
        .read(searchMediaProvider((query: '海贼', type: MediaTypeFilter.novel)).future);
    expect(outcome.items, isEmpty);
    expect(outcome.failures.keys, contains('服务器'));
    expect(outcome.failures.values.first, contains('小说'));
  });
}
