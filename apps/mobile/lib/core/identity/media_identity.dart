class MediaIdentity {
  const MediaIdentity({
    required this.pluginId,
    required this.mediaType,
    required this.mediaId,
  });

  final String pluginId;
  final String mediaType;
  final String mediaId;

  String get key => '$pluginId\u0000$mediaType\u0000$mediaId';

  @override
  bool operator ==(Object other) =>
      other is MediaIdentity &&
      other.pluginId == pluginId &&
      other.mediaType == mediaType &&
      other.mediaId == mediaId;

  @override
  int get hashCode => Object.hash(pluginId, mediaType, mediaId);

  @override
  String toString() => '$pluginId/$mediaType/$mediaId';
}

const Set<String> knownMediaTypes = {'anime', 'manga', 'novel', 'movie'};

String resolveMediaType({Iterable<String>? types, String? mediaId}) {
  if (types != null) {
    for (final type in types) {
      if (knownMediaTypes.contains(type)) return type;
    }
  }
  final id = (mediaId ?? '').toLowerCase();
  if (id.contains('manga') || id.contains('comic')) return 'manga';
  if (id.contains('novel') || id.contains('book')) return 'novel';
  if (id.contains('movie') || id.contains('film')) return 'movie';
  return 'anime';
}
