import 'dart:io' show HttpDate;

class VeneraCookie {
  VeneraCookie({
    required this.name,
    required this.value,
    required this.domain,
    this.path = '/',
    this.expires,
    this.secure = false,
    this.httpOnly = false,
    this.hostOnly = false,
  });

  factory VeneraCookie.fromJson(Map json) => VeneraCookie(
        name: '${json['name']}',
        value: '${json['value']}',
        domain: '${json['domain']}',
        path: json['path'] is String ? json['path'] as String : '/',
        expires: json['expires'] is int ? DateTime.fromMillisecondsSinceEpoch(json['expires'] as int, isUtc: true) : null,
        secure: json['secure'] == true,
        httpOnly: json['httpOnly'] == true,
        hostOnly: json['hostOnly'] == true,
      );

  final String name;
  String value;
  final String domain;
  final String path;
  final DateTime? expires;
  final bool secure;
  final bool httpOnly;
  final bool hostOnly;

  bool get expired => expires != null && !expires!.isAfter(DateTime.now().toUtc());

  Map<String, dynamic> toJson() => {
        'name': name,
        'value': value,
        'domain': domain,
        'path': path,
        'expires': expires?.millisecondsSinceEpoch,
        'secure': secure,
        'httpOnly': httpOnly,
        'hostOnly': hostOnly,
      };

  Map<String, dynamic> toScript() => {
        'name': name,
        'value': value,
        'domain': domain,
        'path': path,
        'secure': secure,
        'httpOnly': httpOnly,
        'session': expires == null,
      };
}

class VeneraCookieJar {
  VeneraCookieJar([Iterable<VeneraCookie> initial = const []]) {
    _cookies.addAll(initial);
  }

  final List<VeneraCookie> _cookies = [];

  bool get isEmpty => _cookies.isEmpty;

  List<VeneraCookie> get all => List.unmodifiable(_cookies);

  static bool _domainMatches(String host, String domain, bool hostOnly) {
    final normalized = domain.startsWith('.') ? domain.substring(1) : domain;
    if (hostOnly) return host == normalized;
    return host == normalized || host.endsWith('.$normalized');
  }

  static bool _pathMatches(String requestPath, String cookiePath) {
    if (cookiePath == '/' || requestPath == cookiePath) return true;
    return requestPath.startsWith(cookiePath.endsWith('/') ? cookiePath : '$cookiePath/');
  }

  List<VeneraCookie> forUri(Uri uri) {
    _cookies.removeWhere((c) => c.expired);
    final path = uri.path.isEmpty ? '/' : uri.path;
    return [
      for (final cookie in _cookies)
        if (_domainMatches(uri.host, cookie.domain, cookie.hostOnly) &&
            _pathMatches(path, cookie.path) &&
            (!cookie.secure || uri.scheme == 'https'))
          cookie,
    ];
  }

  String? headerFor(Uri uri) {
    final matching = forUri(uri);
    if (matching.isEmpty) return null;
    return matching.map((c) => '${c.name}=${c.value}').join('; ');
  }

  void set(VeneraCookie cookie) {
    _cookies.removeWhere((c) => c.name == cookie.name && c.domain == cookie.domain && c.path == cookie.path);
    if (!cookie.expired) _cookies.add(cookie);
  }

  void setForUri(Uri uri, List<Map> cookies) {
    for (final item in cookies) {
      final name = item['name'];
      if (name is! String || name.isEmpty) continue;
      final domain = item['domain'];
      set(VeneraCookie(
        name: name,
        value: '${item['value'] ?? ''}',
        domain: domain is String && domain.isNotEmpty ? domain : uri.host,
        hostOnly: domain is! String || domain.isEmpty,
      ));
    }
  }

  void deleteForUri(Uri uri) {
    _cookies.removeWhere((c) => _domainMatches(uri.host, c.domain, c.hostOnly));
  }

  void clear() => _cookies.clear();

  void storeFromResponse(Uri uri, Iterable<String> setCookieHeaders) {
    for (final header in setCookieHeaders) {
      final cookie = _parseSetCookie(uri, header);
      if (cookie != null) set(cookie);
    }
  }

  VeneraCookie? _parseSetCookie(Uri uri, String header) {
    final parts = header.split(';');
    final pair = parts.first;
    final eq = pair.indexOf('=');
    if (eq <= 0) return null;
    final name = pair.substring(0, eq).trim();
    final value = pair.substring(eq + 1).trim();
    String? domain;
    var path = '/';
    DateTime? expires;
    var secure = false;
    var httpOnly = false;
    for (final attribute in parts.skip(1)) {
      final index = attribute.indexOf('=');
      final key = (index < 0 ? attribute : attribute.substring(0, index)).trim().toLowerCase();
      final val = index < 0 ? '' : attribute.substring(index + 1).trim();
      switch (key) {
        case 'domain':
          if (val.isNotEmpty) domain = val;
        case 'path':
          if (val.startsWith('/')) path = val;
        case 'max-age':
          final seconds = int.tryParse(val);
          if (seconds != null) expires = DateTime.now().toUtc().add(Duration(seconds: seconds));
        case 'expires':
          if (expires == null) {
            try {
              expires = HttpDate.parse(val);
            } catch (_) {}
          }
        case 'secure':
          secure = true;
        case 'httponly':
          httpOnly = true;
      }
    }
    if (domain != null && !_domainMatches(uri.host, domain, false)) return null;
    return VeneraCookie(
      name: name,
      value: value,
      domain: domain ?? uri.host,
      path: path,
      expires: expires,
      secure: secure,
      httpOnly: httpOnly,
      hostOnly: domain == null,
    );
  }
}
