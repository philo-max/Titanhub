import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/sources/local_sources.dart';
import 'package:titanhub/core/sources/media_source.dart';

void main() {
  group('来源清单', () {
    test('真实来源不含 Mock，且每个来源有显式 ID 与能力', () {
      expect(bundledSources, isNotEmpty);
      for (final source in bundledSources) {
        expect(source.isMock, isFalse, reason: source.id);
        expect(source.id, isNotEmpty);
        expect(source.capabilities, isNotEmpty, reason: source.id);
        expect(source.types, isNotEmpty, reason: source.id);
      }
      final ids = bundledSources.map((s) => s.id).toList();
      expect(ids.toSet().length, ids.length, reason: '来源 ID 必须唯一');
      expect(ids.any((id) => id.startsWith('mock')), isFalse);
    });

    test('Mock 来源被标记且不出现在真实列表', () {
      expect(mockSources.every((s) => s.isMock), isTrue);
      for (final mock in mockSources) {
        expect(bundledSources.any((s) => s.id == mock.id), isFalse);
      }
    });

    test('Bangumi 不声明播放能力，MangaDex 声明漫画图片', () {
      final bangumi = bundledSources.firstWhere((s) => s.id == 'bangumi');
      expect(bangumi.supports(MediaCapability.video), isFalse);
      expect(bangumi.supports(MediaCapability.search), isTrue);
      final mangadex = bundledSources.firstWhere((s) => s.id == 'mangadex');
      expect(mangadex.supports(MediaCapability.images), isTrue);
      expect(mangadex.supports(MediaCapability.content), isFalse);
    });
  });

  group('provider 默认值', () {
    test('默认不连远端，默认启用全部本机来源', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(remoteEnabledProvider), isFalse);
      expect(container.read(enabledSourceIdsProvider),
          {for (final s in bundledSources) s.id});
      expect(container.read(activeSourcesProvider).length, bundledSources.length);
    });

    test('关闭来源后不再参与搜索', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      container.read(enabledSourceIdsProvider.notifier).state = {'bangumi'};
      final active = container.read(activeSourcesProvider);
      expect(active.map((s) => s.id), ['bangumi']);
    });

    test('未知与 Mock 来源查询不到', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(sourceByIdProvider('mangadex'))?.name, 'MangaDex 漫画');
      expect(container.read(sourceByIdProvider('mock-dmzj')), isNull);
      expect(container.read(sourceByIdProvider('missing')), isNull);
    });
  });

  group('分类筛选', () {
    test('默认分类为全部，分类只筛来源不改启用集合', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(selectedMediaTypeProvider), MediaTypeFilter.all);
      final before = container.read(enabledSourceIdsProvider);
      expect(container.read(searchSourcesProvider(MediaTypeFilter.all)).length,
          bundledSources.length);
      expect(container.read(searchSourcesProvider(MediaTypeFilter.manga)).map((s) => s.id),
          ['mangadex']);
      expect(container.read(searchSourcesProvider(MediaTypeFilter.anime)).map((s) => s.id),
          containsAll(['bangumi', 'kazumi-7sefun']));
      expect(container.read(searchSourcesProvider(MediaTypeFilter.novel)), isEmpty);
      expect(container.read(searchSourcesProvider(MediaTypeFilter.movie)), isEmpty);
      expect(container.read(enabledSourceIdsProvider), before);
    });

    test('分类筛选尊重来源开关', () {
      final container = ProviderContainer();
      addTearDown(container.dispose);
      container.read(enabledSourceIdsProvider.notifier).state = {'bangumi'};
      expect(container.read(searchSourcesProvider(MediaTypeFilter.manga)), isEmpty);
      expect(container.read(searchSourcesProvider(MediaTypeFilter.anime)).map((s) => s.id),
          ['bangumi']);
    });

    test('分类类型参数与服务器约定一致', () {
      expect(MediaTypeFilter.all.type, isNull);
      expect(MediaTypeFilter.values.map((f) => f.type).whereType<String>(),
          ['anime', 'manga', 'novel', 'movie']);
    });
  });

  group('SearchOutcome', () {
    test('空结果仍可携带失败原因', () {
      const outcome = SearchOutcome(
        items: [],
        failures: {'Bangumi 番组计划': '网络不可用'},
        searchedSources: 1,
      );
      expect(outcome.hasFailures, isTrue);
      expect(outcome.items, isEmpty);
    });
  });
}
