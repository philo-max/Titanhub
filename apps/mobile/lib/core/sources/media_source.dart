import '../../features/media/models/media_models.dart';

enum MediaCapability { search, detail, chapters, video, images, content }

extension MediaCapabilityLabel on MediaCapability {
  String get label => switch (this) {
        MediaCapability.search => '搜索',
        MediaCapability.detail => '详情',
        MediaCapability.chapters => '章节',
        MediaCapability.video => '视频',
        MediaCapability.images => '漫画图片',
        MediaCapability.content => '小说正文',
      };
}

class MediaSource {
  const MediaSource({
    required this.id,
    required this.name,
    required this.types,
    required this.capabilities,
    this.isMock = false,
  });

  final String id;
  final String name;
  final List<String> types;
  final Set<MediaCapability> capabilities;
  final bool isMock;

  bool get isReal => !isMock;

  bool supports(MediaCapability capability) => capabilities.contains(capability);

  String get capabilitySummary =>
      MediaCapability.values.where(capabilities.contains).map((c) => c.label).join(' / ');
}

class SourceUnavailableException implements Exception {
  const SourceUnavailableException(this.message);

  final String message;

  @override
  String toString() => message;
}

class SearchOutcome {
  const SearchOutcome({
    required this.items,
    required this.failures,
    required this.searchedSources,
    this.remoteRequested = false,
  });

  const SearchOutcome.empty()
      : items = const <MediaItem>[],
        failures = const <String, String>{},
        searchedSources = 0,
        remoteRequested = false;

  final List<MediaItem> items;

  final Map<String, String> failures;

  final int searchedSources;
  final bool remoteRequested;

  bool get hasFailures => failures.isNotEmpty;
}
