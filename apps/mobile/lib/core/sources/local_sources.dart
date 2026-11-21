import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sandbox/local_plugin_runner.dart';
import 'media_source.dart';
import 'novel/legado_store.dart';
import 'novel/linovelib_source.dart';
import 'seven_se_fun_source.dart';

const List<MediaSource> bundledSources = [
  MediaSource(
    id: 'bangumi',
    name: 'Bangumi 番组计划',
    types: ['anime'],
    capabilities: {
      MediaCapability.search,
      MediaCapability.detail,
      MediaCapability.chapters,
    },
  ),
  MediaSource(
    id: SevenSeFunSource.pluginId,
    name: SevenSeFunSource.sourceName,
    types: ['anime'],
    capabilities: {
      MediaCapability.search,
      MediaCapability.detail,
      MediaCapability.chapters,
      MediaCapability.video,
    },
  ),
  MediaSource(
    id: 'mangadex',
    name: 'MangaDex 漫画',
    types: ['manga'],
    capabilities: {
      MediaCapability.search,
      MediaCapability.detail,
      MediaCapability.chapters,
      MediaCapability.images,
    },
  ),
];

const List<MediaSource> mockSources = [
  MediaSource(
    id: 'mock-dmzj',
    name: '动漫之家 Mock',
    types: ['manga', 'novel'],
    capabilities: {
      MediaCapability.search,
      MediaCapability.detail,
      MediaCapability.chapters,
      MediaCapability.images,
      MediaCapability.content,
    },
    isMock: true,
  ),
  MediaSource(
    id: 'mock-movie',
    name: '影视 Mock',
    types: ['movie'],
    capabilities: {
      MediaCapability.search,
      MediaCapability.detail,
      MediaCapability.chapters,
      MediaCapability.video,
    },
    isMock: true,
  ),
];

final installedKazumiSourcesProvider = StateProvider<List<MediaSource>>((ref) => const []);

final installedVeneraSourcesProvider = StateProvider<List<MediaSource>>((ref) => const []);

final installedNovelSourcesProvider = StateProvider<List<MediaSource>>((ref) => const []);

const MediaSource linovelibMediaSource = MediaSource(
  id: LinovelibSource.pluginId,
  name: LinovelibSource.sourceName,
  types: ['novel'],
  capabilities: {
    MediaCapability.search,
    MediaCapability.detail,
    MediaCapability.chapters,
    MediaCapability.content,
  },
);

final novelBootstrapProvider = FutureProvider<void>((ref) async {
  final store = ref.read(legadoStoreProvider);
  final savedLegado = await store.loadAll();
  final runner = ref.read(localPluginRunnerProvider);
  final savedSources = <MediaSource>[];
  for (final src in savedLegado) {
    runner.registerLegadoSource(src.stableId, src);
    savedSources.add(src.toMediaSource());
  }

  Future<void>.microtask(() {
    final current = ref.read(installedNovelSourcesProvider);
    final mergedById = <String, MediaSource>{
      linovelibMediaSource.id: linovelibMediaSource,
      for (final s in current) s.id: s,
      for (final s in savedSources) s.id: s,
    };
    ref.read(installedNovelSourcesProvider.notifier).state = mergedById.values.toList();
    ref.read(enabledSourceIdsProvider.notifier).update(
          (s) => {...s, ...mergedById.keys},
        );
  });
});

final localSourcesProvider = Provider<List<MediaSource>>((ref) => [
      ...bundledSources,
      ...ref.watch(installedKazumiSourcesProvider),
      ...ref.watch(installedVeneraSourcesProvider),
      ...ref.watch(installedNovelSourcesProvider),
    ]);

final sourceByIdProvider = Provider.family<MediaSource?, String>((ref, id) {
  for (final source in ref.watch(localSourcesProvider)) {
    if (source.id == id) return source;
  }
  return null;
});

final enabledSourceIdsProvider =
    StateProvider<Set<String>>((ref) => {for (final s in bundledSources) s.id});

final activeSourcesProvider = Provider<List<MediaSource>>((ref) {
  final enabled = ref.watch(enabledSourceIdsProvider);
  return [
    for (final source in ref.watch(localSourcesProvider))
      if (enabled.contains(source.id) && source.supports(MediaCapability.search)) source,
  ];
});

enum MediaTypeFilter {
  all('全部', null),
  anime('动漫', 'anime'),
  manga('漫画', 'manga'),
  novel('小说', 'novel'),
  movie('影视', 'movie');

  const MediaTypeFilter(this.label, this.type);

  final String label;
  final String? type;

  bool matches(MediaSource source) => type == null || source.types.contains(type);
}

final selectedMediaTypeProvider = StateProvider<MediaTypeFilter>((ref) => MediaTypeFilter.all);

final selectedSourceIdProvider = StateProvider<String?>((ref) => null);

final typeSourcesProvider = Provider.family<List<MediaSource>, MediaTypeFilter>((ref, filter) {
  return [
    for (final source in ref.watch(activeSourcesProvider))
      if (filter.matches(source)) source,
  ];
});

final searchSourcesProvider = Provider.family<List<MediaSource>, MediaTypeFilter>((ref, filter) {
  final sources = ref.watch(typeSourcesProvider(filter));
  final selectedId = ref.watch(selectedSourceIdProvider);
  if (selectedId == null) return sources;
  final matched = [
    for (final source in sources)
      if (source.id == selectedId) source,
  ];
  return matched.isNotEmpty ? matched : sources;
});

final remoteEnabledProvider = StateProvider<bool>((ref) => false);

final dataSaverEnabledProvider = StateProvider<bool>((ref) => false);

final pendingSearchQueryProvider = StateProvider<String?>((ref) => null);
