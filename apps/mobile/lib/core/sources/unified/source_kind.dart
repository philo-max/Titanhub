enum SourceKind {
  anime('anime', '动漫', '动漫源配置', true),
  manga('manga', '漫画', '漫画源配置', true),
  novel('novel', '小说', '小说源配置', false),
  movie('movie', '影视', '影视源配置', false);

  const SourceKind(this.slug, this.label, this.title, this.available);

  final String slug;
  final String label;
  final String title;
  final bool available;

  static SourceKind? fromSlug(String slug) {
    for (final kind in SourceKind.values) {
      if (kind.slug == slug) return kind;
    }
    return null;
  }
}
