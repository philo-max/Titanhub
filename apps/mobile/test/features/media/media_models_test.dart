import 'package:flutter_test/flutter_test.dart';
import 'package:titanhub/features/media/models/media_models.dart';

void main() {
  group('VideoSource 契约', () {
    test('旧插件只返回 quality/url 时默认为直链且无请求头', () {
      final source = VideoSource.fromJson({'quality': '1080P', 'url': 'https://cdn.example/a.mp4'});
      expect(source.type, VideoSource.typeDirect);
      expect(source.isPage, isFalse);
      expect(source.headers, isEmpty);
      expect(source.quality, '1080P');
    });

    test('page 类型保留 Referer/UA 请求头并丢弃非字符串键', () {
      final source = VideoSource.fromJson({
        'quality': '线路1',
        'url': 'https://www.7sefun.top/play/1-1-1.html',
        'type': 'page',
        'headers': {'Referer': 'https://www.7sefun.top/', 'User-Agent': 'UA/1.0', 1: 'x', 'Empty': null},
      });
      expect(source.isPage, isTrue);
      expect(source.headers, {'Referer': 'https://www.7sefun.top/', 'User-Agent': 'UA/1.0'});
    });

    test('未知类型按直链兼容处理', () {
      final source = VideoSource.fromJson({'quality': '', 'url': 'https://a.example/v.m3u8', 'type': 'weird'});
      expect(source.type, VideoSource.typeDirect);
    });
  });

  group('Chapter 线路分组', () {
    test('读取 groupId/groupName', () {
      final chapter = Chapter.fromJson({'id': 'e1', 'title': '第1集', 'groupId': 'line-2', 'groupName': '线路2'});
      expect(chapter.groupId, 'line-2');
      expect(chapter.groupName, '线路2');
    });

    test('兼容桌面 lineId/lineName 字段', () {
      final chapter = Chapter.fromJson({'id': 'e1', 'title': '第1集', 'lineId': 'line-1', 'lineName': '主线'});
      expect(chapter.groupId, 'line-1');
      expect(chapter.groupName, '主线');
    });

    test('旧插件无分组字段时为空', () {
      final chapter = Chapter.fromJson({'id': 'c1', 'title': 'Ch.1', 'chapterNo': 1});
      expect(chapter.groupId, isNull);
      expect(chapter.groupName, isNull);
      expect(chapter.chapterNo, 1);
    });
  });
}
