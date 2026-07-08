class MediaItem {
  final String id;
  final String title;
  final String cover;
  final String? description;
  final String? pluginId;
  final String? pluginName;

  MediaItem({
    required this.id,
    required this.title,
    required this.cover,
    this.description,
    this.pluginId,
    this.pluginName,
  });

  factory MediaItem.fromJson(Map<String, dynamic> json) {
    return MediaItem(
      id: json['id'] ?? '',
      title: json['title'] ?? '',
      cover: json['cover'] ?? '',
      description: json['description'],
      pluginId: json['pluginId'],
      pluginName: json['pluginName'],
    );
  }
}

class MediaDetail {
  final String id;
  final String title;
  final String cover;
  final String? description;
  final String? status;
  final String? author;
  final List<String> genres;
  final String? lastUpdate;

  MediaDetail({
    required this.id,
    required this.title,
    required this.cover,
    this.description,
    this.status,
    this.author,
    required this.genres,
    this.lastUpdate,
  });

  factory MediaDetail.fromJson(Map<String, dynamic> json) {
    var genresJson = json['genres'];
    List<String> parsedGenres = [];
    if (genresJson != null && genresJson is List) {
      parsedGenres = List<String>.from(genresJson);
    }

    return MediaDetail(
      id: json['id'] ?? '',
      title: json['title'] ?? '',
      cover: json['cover'] ?? '',
      description: json['description'],
      status: json['status'],
      author: json['author'],
      genres: parsedGenres,
      lastUpdate: json['lastUpdate'],
    );
  }
}

class Chapter {
  final String id;
  final String title;
  final int? chapterNo;

  Chapter({
    required this.id,
    required this.title,
    this.chapterNo,
  });

  factory Chapter.fromJson(Map<String, dynamic> json) {
    return Chapter(
      id: json['id'] ?? '',
      title: json['title'] ?? '',
      chapterNo: json['chapterNo'],
    );
  }
}

class VideoSource {
  final String quality;
  final String url;

  VideoSource({
    required this.quality,
    required this.url,
  });

  factory VideoSource.fromJson(Map<String, dynamic> json) {
    return VideoSource(
      quality: json['quality'] ?? '',
      url: json['url'] ?? '',
    );
  }
}

class DanmakuComment {
  final String id;
  final String text;
  final double time; // in seconds
  final String color;

  DanmakuComment({
    required this.id,
    required this.text,
    required this.time,
    required this.color,
  });

  factory DanmakuComment.fromJson(Map<String, dynamic> json) {
    return DanmakuComment(
      id: json['id'] ?? '',
      text: json['text'] ?? '',
      time: (json['time'] as num).toDouble(),
      color: json['color'] ?? '#FFFFFF',
    );
  }
}
