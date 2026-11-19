import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:drift/drift.dart';

import '../../../core/network/api_client.dart';
import '../../../core/playback/video_resolver.dart';
import '../../../core/playback/webview_page_probe.dart';
import '../../../core/sandbox/local_plugin_runner.dart';
import '../../../core/sources/local_sources.dart';
import '../../../core/sources/media_source.dart';
import '../../../core/storage/app_database.dart';
import '../../tracking/sync_provider.dart';
import '../models/media_models.dart';

final pluginsListProvider = FutureProvider<List<MediaSource>>((ref) async {
  return ref.watch(localSourcesProvider);
});

Future<T> _withSource<T>(
  Ref ref, {
  required String pluginId,
  required MediaCapability capability,
  required Future<T> Function(LocalPluginRunner runner) local,
  required Future<T> Function(dynamic dio) remote,
}) async {
  final source = ref.watch(sourceByIdProvider(pluginId));
  if (source == null) {
    throw SourceUnavailableException('本机未安装来源「$pluginId」，请在来源列表中选择可用来源。');
  }
  if (source.isMock) {
    throw SourceUnavailableException('来源「${source.name}」仅用于沙箱自测，不提供真实内容。');
  }
  if (!source.supports(capability)) {
    throw SourceUnavailableException(
      '来源「${source.name}」不支持${capability.label}，已支持：${source.capabilitySummary}。',
    );
  }

  final runner = ref.watch(localPluginRunnerProvider);
  try {
    return await local(runner);
  } catch (error) {
    if (!ref.read(remoteEnabledProvider)) {
      throw SourceUnavailableException('来源「${source.name}」本机请求失败：$error');
    }
    final dio = ref.read(apiClientProvider);
    return await remote(dio);
  }
}

typedef SearchRequest = ({String query, MediaTypeFilter type});

List<MediaItem> _parseRemoteSearch(dynamic data, Set<String> localIds) {
  final List<dynamic> groups = data is Map ? (data['items'] ?? const []) : const [];
  final items = <MediaItem>[];
  for (final entry in groups) {
    final group = Map<String, dynamic>.from(entry);
    final sources = [
      for (final s in (group['sources'] as List<dynamic>? ?? const []))
        Map<String, dynamic>.from(s),
    ];
    if (sources.isEmpty) continue;
    final source = sources.firstWhere(
      (s) => localIds.contains(s['pluginId']),
      orElse: () => sources.first,
    );
    items.add(MediaItem.fromJson({
      ...group,
      'id': source['mediaId'],
      'pluginId': source['pluginId'],
      'pluginName': source['pluginName'],
    }));
  }
  return items;
}

const Duration _searchSourceTimeout = Duration(seconds: 10);

final searchMediaProvider =
    FutureProvider.family<SearchOutcome, SearchRequest>((ref, request) async {
  final trimmed = request.query.trim();
  if (trimmed.isEmpty) return const SearchOutcome.empty();

  final filter = request.type;
  final sources = ref.watch(searchSourcesProvider(filter));
  final remoteEnabled = ref.watch(remoteEnabledProvider);
  final runner = ref.watch(localPluginRunnerProvider);
  final items = <MediaItem>[];
  final failures = <String, String>{};

  if (sources.isEmpty) {
    failures['来源'] = filter == MediaTypeFilter.all
        ? '没有已启用且支持搜索的来源'
        : '「${filter.label}」分类没有已启用且支持搜索的本机来源';
  }

  final outcomes = await Future.wait([
    for (final source in sources)
      () async {
        try {
          final List<dynamic> raw = await runner
              .call(source.id, 'search', [trimmed])
              .timeout(_searchSourceTimeout);
          final found = <MediaItem>[];
          for (final entry in raw) {
            final map = Map<String, dynamic>.from(entry);
            map['pluginId'] = source.id;
            map['pluginName'] = source.name;
            found.add(MediaItem.fromJson(map));
          }
          return (items: found, error: null as String?);
        } catch (error) {
          return (items: const <MediaItem>[], error: '$error' as String?);
        }
      }(),
  ]);
  for (var i = 0; i < sources.length; i++) {
    items.addAll(outcomes[i].items);
    final error = outcomes[i].error;
    if (error != null) failures[sources[i].name] = error;
  }

  if (remoteEnabled && items.isEmpty) {
    try {
      final dio = ref.read(apiClientProvider);
      final response = await dio.get('/api/aggregate/search', queryParameters: {
        'q': trimmed,
        if (filter.type != null) 'type': filter.type,
      });
      final localIds = {for (final s in ref.read(localSourcesProvider)) s.id};
      items.addAll(_parseRemoteSearch(response.data, localIds));
    } catch (error) {
      failures['服务器'] = '$error';
    }
  }

  return SearchOutcome(
    items: items,
    failures: failures,
    searchedSources: sources.length,
    remoteRequested: remoteEnabled,
  );
});

final mediaDetailProvider =
    FutureProvider.family<MediaDetail, ({String pluginId, String mediaId})>((ref, arg) async {
  return _withSource<MediaDetail>(
    ref,
    pluginId: arg.pluginId,
    capability: MediaCapability.detail,
    local: (runner) async {
      final data = await runner.call(arg.pluginId, 'getDetail', [arg.mediaId]);
      return MediaDetail.fromJson(Map<String, dynamic>.from(data));
    },
    remote: (dio) async {
      final response = await dio.get('/api/plugins/${arg.pluginId}/detail/${arg.mediaId}');
      return MediaDetail.fromJson(Map<String, dynamic>.from(response.data['detail']));
    },
  );
});

final mediaChaptersProvider =
    FutureProvider.family<List<Chapter>, ({String pluginId, String mediaId})>((ref, arg) async {
  return _withSource<List<Chapter>>(
    ref,
    pluginId: arg.pluginId,
    capability: MediaCapability.chapters,
    local: (runner) async {
      final List<dynamic> raw = await runner.call(arg.pluginId, 'getChapters', [arg.mediaId]);
      return raw.map((c) => Chapter.fromJson(Map<String, dynamic>.from(c))).toList();
    },
    remote: (dio) async {
      final response = await dio.get('/api/plugins/${arg.pluginId}/chapters/${arg.mediaId}');
      final List<dynamic> raw = response.data['chapters'] ?? [];
      return raw.map((c) => Chapter.fromJson(Map<String, dynamic>.from(c))).toList();
    },
  );
});

final mediaVideoSourcesProvider =
    FutureProvider.autoDispose.family<List<VideoSource>, ({String pluginId, String chapterId})>((ref, arg) async {
  final session = VideoResolveSession(ref.watch(videoResolverProvider));
  var disposed = false;
  ref.onDispose(() {
    disposed = true;
    session.cancel();
  });
  final sources = await _withSource<List<VideoSource>>(
    ref,
    pluginId: arg.pluginId,
    capability: MediaCapability.video,
    local: (runner) async {
      final List<dynamic> raw = await runner.call(arg.pluginId, 'getVideoUrl', [arg.chapterId]);
      return raw.map((v) => VideoSource.fromJson(Map<String, dynamic>.from(v))).toList();
    },
    remote: (dio) async {
      final response = await dio.get('/api/plugins/${arg.pluginId}/video/${arg.chapterId}');
      final List<dynamic> raw = response.data['videos'] ?? [];
      return raw.map((v) => VideoSource.fromJson(Map<String, dynamic>.from(v))).toList();
    },
  );
  if (disposed) {
    throw const VideoResolveException(VideoResolveFailure.cancelled, '播放请求已取消');
  }
  final playable = <VideoSource>[];
  for (final source in sources) {
    playable.add(await session.resolve(source));
  }
  return playable;
});

final videoResolverProvider = Provider<VideoResolver>((ref) {
  return VideoResolver(probeFactory: createWebViewPageProbe);
});

final mediaDanmakusProvider =
    FutureProvider.family<List<DanmakuComment>, ({String pluginId, String mediaId, String chapterId})>(
        (ref, arg) async {
  if (!ref.watch(remoteEnabledProvider)) return const <DanmakuComment>[];
  try {
    final dio = ref.read(apiClientProvider);
    final response = await dio.get('/api/danmaku/${arg.pluginId}/${arg.mediaId}/${arg.chapterId}');
    final List<dynamic> raw = response.data['comments'] ?? [];
    return raw.map((c) => DanmakuComment.fromJson(Map<String, dynamic>.from(c))).toList();
  } catch (_) {
    return const <DanmakuComment>[];
  }
});

final mangaPagesProvider =
    FutureProvider.family<List<String>, ({String pluginId, String chapterId})>((ref, arg) async {
  final dataSaver = ref.watch(dataSaverEnabledProvider);
  return _withSource<List<String>>(
    ref,
    pluginId: arg.pluginId,
    capability: MediaCapability.images,
    local: (runner) async {
      final callArgs = arg.pluginId == 'mangadex' && dataSaver
          ? <dynamic>[arg.chapterId, {'dataSaver': true}]
          : <dynamic>[arg.chapterId];
      final List<dynamic> raw = await runner.call(arg.pluginId, 'getImages', callArgs);
      return List<String>.from(raw);
    },
    remote: (dio) async {
      final response = await dio.get('/api/plugins/${arg.pluginId}/images/${arg.chapterId}');
      return List<String>.from(response.data['images'] ?? const []);
    },
  );
});

final sourceExploreTabsProvider = FutureProvider.family<List<String>, String>((ref, pluginId) async {
  final runner = ref.watch(localPluginRunnerProvider);
  return runner.exploreTabsFor(pluginId);
});

typedef ExploreRequest = ({String pluginId, String tab, String mediaType});

final sourceExploreItemsProvider = FutureProvider.family<List<MediaItem>, ExploreRequest>((ref, arg) async {
  final runner = ref.watch(localPluginRunnerProvider);
  final source = ref.watch(sourceByIdProvider(arg.pluginId));
  final callArg = runner.hasVeneraSource(arg.pluginId) ? arg.tab : arg.mediaType;
  final raw = await runner
      .call(arg.pluginId, 'explore', [callArg])
      .timeout(_searchSourceTimeout);
  if (raw is! List) return const <MediaItem>[];
  return [
    for (final entry in raw)
      if (entry is Map)
        MediaItem.fromJson({
          ...Map<String, dynamic>.from(entry),
          'pluginId': arg.pluginId,
          'pluginName': source?.name ?? arg.pluginId,
        }),
  ];
});

final novelContentProvider =
    FutureProvider.family<String, ({String pluginId, String chapterId})>((ref, arg) async {
  return _withSource<String>(
    ref,
    pluginId: arg.pluginId,
    capability: MediaCapability.content,
    local: (runner) async {
      final content = await runner.call(arg.pluginId, 'getContent', [arg.chapterId]);
      return content?.toString() ?? '';
    },
    remote: (dio) async {
      final response = await dio.get('/api/plugins/${arg.pluginId}/content/${arg.chapterId}');
      return (response.data['content'] ?? '').toString();
    },
  );
});

final isFavoriteProvider =
    StreamProvider.family<bool, ({String pluginId, String mediaId})>((ref, arg) {
  final db = ref.watch(databaseProvider);
  return (db.select(db.localFavorites)
        ..where((t) => t.mediaId.equals(arg.mediaId) & t.pluginId.equals(arg.pluginId)))
      .watch()
      .map((list) => list.isNotEmpty);
});

final lastTrackingProvider =
    StreamProvider.family<LocalTrackingData?, ({String pluginId, String mediaId})>((ref, arg) {
  final db = ref.watch(databaseProvider);
  return (db.select(db.localTracking)
        ..where((t) => t.mediaId.equals(arg.mediaId) & t.pluginId.equals(arg.pluginId)))
      .watchSingleOrNull();
});
