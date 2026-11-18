import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const String webDavConfigStorageKey = 'titanhub.webdav.config.v1';

abstract class SecureKeyValue {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class FlutterSecureKeyValue implements SecureKeyValue {
  FlutterSecureKeyValue([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(),
            );

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class StoredWebDavConfig {
  const StoredWebDavConfig({
    required this.url,
    required this.username,
    required this.password,
    required this.allowInsecureHttp,
  });

  final String url;
  final String username;
  final String password;
  final bool allowInsecureHttp;

  Map<String, Object> toJson() => {
        'url': url,
        'username': username,
        'password': password,
        'allowInsecureHttp': allowInsecureHttp,
      };

  @override
  String toString() => 'StoredWebDavConfig($url, $username, ***)';
}

class WebDavConfigCorrupted implements Exception {
  const WebDavConfigCorrupted();

  @override
  String toString() => '本机保存的 WebDAV 配置已损坏，请清除后重新填写';
}

class WebDavConfigStore {
  WebDavConfigStore([SecureKeyValue? storage]) : _storage = storage ?? FlutterSecureKeyValue();

  final SecureKeyValue _storage;

  Future<StoredWebDavConfig?> load() async {
    final raw = await _storage.read(webDavConfigStorageKey);
    if (raw == null) return null;
    final Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      throw const WebDavConfigCorrupted();
    }
    if (decoded is! Map<String, dynamic>) throw const WebDavConfigCorrupted();
    final url = decoded['url'];
    final username = decoded['username'];
    final password = decoded['password'];
    final allowInsecureHttp = decoded['allowInsecureHttp'];
    if (url is! String || username is! String || password is! String || allowInsecureHttp is! bool) {
      throw const WebDavConfigCorrupted();
    }
    if (url.isEmpty || username.isEmpty || password.isEmpty) throw const WebDavConfigCorrupted();
    return StoredWebDavConfig(
      url: url,
      username: username,
      password: password,
      allowInsecureHttp: allowInsecureHttp,
    );
  }

  Future<void> save(StoredWebDavConfig config) async {
    if (config.url.isEmpty || config.username.isEmpty || config.password.isEmpty) {
      throw ArgumentError('WebDAV 配置不完整');
    }
    await _storage.write(webDavConfigStorageKey, jsonEncode(config.toJson()));
  }

  Future<void> clear() => _storage.delete(webDavConfigStorageKey);
}
