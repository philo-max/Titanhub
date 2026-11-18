import 'kazumi_rule.dart';

String absolutizeKazumiUrl(String baseUrl, String url) {
  if (url.isEmpty) return '';
  if (url.startsWith('//')) return '${baseUrl.split(':').first}:$url';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) {
    final origin = RegExp(r'^https?://[^/]+').firstMatch(baseUrl)?.group(0) ?? baseUrl;
    return '$origin$url';
  }
  return '${baseUrl.replaceFirst(RegExp(r'/$'), '')}/${url.replaceFirst(RegExp(r'^/'), '')}';
}

final RegExp _pathPattern =
    RegExp(r'''^\$(?:(?:\.[\w-]+)|(?:\[(?:\d+|\*|"[^"]+"|'[^']+')\]))*$''');
final RegExp _pathPart = RegExp(r'''\.[\w-]+|\[(?:\d+|\*|"[^"]+"|'[^']+')\]''');
final RegExp _variablePattern =
    RegExp(r'@(keyword|source|episodeUrl|episodeName|roadName)');

List<Object?> kazumiJsonPath(Object? value, String? path) {
  if (path == null || path.isEmpty) return const [];
  if (!_pathPattern.hasMatch(path)) {
    throw KazumiRuleException('不支持的 Kazumi JSONPath: $path');
  }
  var current = <Object?>[value];
  for (final match in _pathPart.allMatches(path.substring(1))) {
    final part = match.group(0)!;
    final key = part.startsWith('.')
        ? part.substring(1)
        : part.substring(1, part.length - 1).replaceAll(RegExp(r'''^["']|["']$'''), '');
    final next = <Object?>[];
    for (final item in current) {
      if (item == null) continue;
      if (key == '*') {
        if (item is List) {
          next.addAll(item);
        } else if (item is Map) {
          next.addAll(item.values);
        }
      } else if (item is Map) {
        if (item.containsKey(key)) next.add(item[key]);
      } else if (item is List) {
        final index = int.tryParse(key);
        if (index != null && index >= 0 && index < item.length) next.add(item[index]);
      }
    }
    current = next;
  }
  return current;
}

Object? kazumiJsonFirst(Object? value, String? path) {
  final values = kazumiJsonPath(value, path);
  return values.isEmpty ? null : values.first;
}

Object? kazumiReplaceVariables(Object? value, Map<String, Object?> variables, {required bool encode}) {
  if (value is String) {
    return value.replaceAllMapped(_variablePattern, (match) {
      final replacement = variables[match.group(1)]?.toString() ?? '';
      return encode ? Uri.encodeComponent(replacement) : replacement;
    });
  }
  if (value is List) {
    return [for (final item in value) kazumiReplaceVariables(item, variables, encode: encode)];
  }
  if (value is Map) {
    return {
      for (final entry in value.entries)
        entry.key.toString(): kazumiReplaceVariables(entry.value, variables, encode: encode),
    };
  }
  return value;
}

String kazumiApiUrl(String baseUrl, Map<String, dynamic> config, Map<String, Object?> variables) {
  var url = absolutizeKazumiUrl(
    baseUrl,
    kazumiReplaceVariables(config['url'], variables, encode: true).toString(),
  );
  final query = kazumiReplaceVariables(config['query'] ?? const {}, variables, encode: false);
  if (query is Map && query.isNotEmpty) {
    final pairs = [
      for (final entry in query.entries)
        '${Uri.encodeComponent(entry.key.toString())}=${Uri.encodeComponent('${entry.value}')}',
    ];
    url += '${url.contains('?') ? '&' : '?'}${pairs.join('&')}';
  }
  return url;
}

class KazumiApiSearchHit {
  const KazumiApiSearchHit({required this.id, required this.title, required this.cover});

  final String id;
  final String title;
  final String cover;
}

List<KazumiApiSearchHit> parseKazumiApiSearch(
  String baseUrl,
  Map<String, dynamic> config,
  Object? data,
) {
  final hits = <KazumiApiSearchHit>[];
  for (final item in kazumiJsonPath(data, config['listPath']?.toString())) {
    final title = kazumiJsonFirst(item, config['namePath']?.toString());
    final rawSource = kazumiJsonFirst(item, config['sourcePath']?.toString());
    if (rawSource == null || rawSource == '' || title == null || '$title'.isEmpty) continue;
    var source = '$rawSource';
    final template = config['sourceTemplate']?.toString() ?? '';
    if (template.isNotEmpty) {
      source = kazumiReplaceVariables(template, {'source': source}, encode: true).toString();
    }
    var cover = kazumiJsonFirst(item, config['coverPath']?.toString());
    if ((cover == null || '$cover'.isEmpty) && item is Map) {
      for (final key in const ['vod_pic', 'cover', 'pic', 'image']) {
        final value = item[key];
        if (value != null && '$value'.isNotEmpty) {
          cover = value;
          break;
        }
      }
    }
    hits.add(KazumiApiSearchHit(
      id: Uri.encodeComponent(source),
      title: '$title',
      cover: absolutizeKazumiUrl(baseUrl, cover == null ? '' : '$cover'),
    ));
  }
  return hits;
}

class KazumiApiChapter {
  const KazumiApiChapter({
    required this.id,
    required this.title,
    required this.chapterNo,
    required this.roadIndex,
    required this.roadName,
  });

  final String id;
  final String title;
  final int chapterNo;
  final int roadIndex;
  final String roadName;
}

class _Road {
  _Road(this.name, this.episodes);

  final String name;
  final List<({Object? name, Object? url})> episodes;
}

List<KazumiApiChapter> parseKazumiApiChapters(
  String baseUrl,
  Map<String, dynamic> config,
  Object? data,
  String source,
) {
  final roads = <_Road>[];
  if (config['format'] == 'delimited') {
    final roadSeparator = config['roadSeparator']?.toString().isNotEmpty == true
        ? config['roadSeparator'].toString()
        : r'$$$';
    final episodeSeparator = config['episodeSeparator']?.toString().isNotEmpty == true
        ? config['episodeSeparator'].toString()
        : '#';
    final fieldSeparator = config['fieldSeparator']?.toString().isNotEmpty == true
        ? config['fieldSeparator'].toString()
        : r'$';
    final names =
        '${kazumiJsonFirst(data, config['roadNamesPath']?.toString()) ?? ''}'.split(roadSeparator);
    final episodes =
        '${kazumiJsonFirst(data, config['roadEpisodesPath']?.toString()) ?? ''}'.split(roadSeparator);
    for (var index = 0; index < episodes.length; index++) {
      roads.add(_Road(index < names.length ? names[index] : '', [
        for (final episode in episodes[index].split(episodeSeparator))
          if (episode.isNotEmpty)
            () {
              final position = episode.indexOf(fieldSeparator);
              return position < 0
                  ? (name: '' as Object?, url: episode as Object?)
                  : (
                      name: episode.substring(0, position) as Object?,
                      url: episode.substring(position + fieldSeparator.length) as Object?,
                    );
            }(),
      ]));
    }
  } else {
    for (final road in kazumiJsonPath(data, config['roadsPath']?.toString())) {
      roads.add(_Road(
        '${kazumiJsonFirst(road, config['roadNamePath']?.toString()) ?? ''}',
        [
          for (final episode in kazumiJsonPath(road, config['episodesPath']?.toString()))
            (
              name: kazumiJsonFirst(episode, config['episodeNamePath']?.toString()),
              url: kazumiJsonFirst(episode, config['episodeUrlPath']?.toString()),
            ),
        ],
      ));
    }
  }

  final chapters = <KazumiApiChapter>[];
  final episodePage = config['episodePage'];
  for (var roadIndex = 0; roadIndex < roads.length; roadIndex++) {
    final road = roads[roadIndex];
    var lineCount = 0;
    for (var index = 0; index < road.episodes.length; index++) {
      final episode = road.episodes[index];
      if (episode.url == null || '${episode.url}'.isEmpty) continue;
      final variables = <String, Object?>{
        'source': source,
        'episodeUrl': episode.url,
        'episodeName': episode.name,
        'roadName': road.name,
      };
      final url = episodePage is Map
          ? kazumiApiUrl(baseUrl, Map<String, dynamic>.from(episodePage), variables)
          : absolutizeKazumiUrl(baseUrl, '${episode.url}');
      lineCount += 1;
      final name = episode.name == null ? '' : '${episode.name}';
      chapters.add(KazumiApiChapter(
        id: Uri.encodeComponent(url),
        title: name.isEmpty ? '第 ${index + 1} 话' : name,
        chapterNo: lineCount,
        roadIndex: roadIndex,
        roadName: road.name.isEmpty ? '线路${roadIndex + 1}' : road.name,
      ));
    }
  }
  return chapters;
}
