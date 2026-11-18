class ResumeTarget {
  const ResumeTarget({this.position, this.progress = 0.0});

  final int? position;
  final double progress;

  bool get hasPosition => position != null && position! > 0;
}

bool isSameChapter(String? savedChapterId, String currentChapterId) {
  if (savedChapterId == null || savedChapterId.isEmpty) return false;
  return savedChapterId == currentChapterId;
}

int? restoredMangaPage({int? savedPage, required int pageCount}) {
  if (savedPage == null || savedPage <= 0 || pageCount <= 1) return null;
  return savedPage.clamp(0, pageCount - 1);
}

double restoredNovelProgress(double savedProgress) {
  if (savedProgress.isNaN) return 0.0;
  return savedProgress.clamp(0.0, 1.0);
}

int? restoredVideoPositionMs({int? savedMs, int? durationMs}) {
  if (savedMs == null || savedMs <= 0) return null;
  if (durationMs != null && durationMs > 0) {
    if (savedMs >= durationMs - 3000) return null;
    return savedMs.clamp(0, durationMs);
  }
  return savedMs;
}
