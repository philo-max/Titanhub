import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/core/playback/resume_target.dart';

void main() {
  group('章节恢复', () {
    test('只有同一章节才恢复位置', () {
      expect(isSameChapter('ep-1', 'ep-1'), isTrue);
      expect(isSameChapter('ep-1', 'ep-2'), isFalse);
      expect(isSameChapter(null, 'ep-1'), isFalse);
      expect(isSameChapter('', 'ep-1'), isFalse);
    });
  });

  group('漫画页恢复', () {
    test('正常页号原样返回', () {
      expect(restoredMangaPage(savedPage: 12, pageCount: 40), 12);
    });

    test('超出总页数时限制在最后一页', () {
      expect(restoredMangaPage(savedPage: 99, pageCount: 40), 39);
    });

    test('负数、零页或无记录时不恢复', () {
      expect(restoredMangaPage(savedPage: -3, pageCount: 40), isNull);
      expect(restoredMangaPage(savedPage: null, pageCount: 40), isNull);
      expect(restoredMangaPage(savedPage: 5, pageCount: 0), isNull);
    });

    test('单页章节无需恢复滚动位置', () {
      expect(restoredMangaPage(savedPage: 0, pageCount: 1), isNull);
    });
  });

  group('小说位置恢复', () {
    test('比例超出范围被收敛', () {
      expect(restoredNovelProgress(1.8), 1.0);
      expect(restoredNovelProgress(-0.4), 0.0);
      expect(restoredNovelProgress(0.62), closeTo(0.62, 0.0001));
    });
  });

  group('视频时间恢复', () {
    test('正常位置直接恢复', () {
      expect(restoredVideoPositionMs(savedMs: 600000, durationMs: 1500000), 600000);
    });

    test('接近结尾时不恢复，避免一进来就结束', () {
      expect(restoredVideoPositionMs(savedMs: 1499000, durationMs: 1500000), isNull);
    });

    test('超过时长时限制在时长内', () {
      expect(restoredVideoPositionMs(savedMs: 1600000, durationMs: 1500000), isNull);
      expect(restoredVideoPositionMs(savedMs: 1200000, durationMs: 1000000), isNull);
    });

    test('没有保存位置或时长为零时不恢复', () {
      expect(restoredVideoPositionMs(savedMs: null, durationMs: 1000), isNull);
      expect(restoredVideoPositionMs(savedMs: 0, durationMs: 1000), isNull);
      expect(restoredVideoPositionMs(savedMs: 5000, durationMs: 0), 5000);
    });
  });
}
