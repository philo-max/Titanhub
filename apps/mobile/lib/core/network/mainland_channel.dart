import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Optional Cloudflare Worker / edge relay base URL for Mainland China users
/// who want to proxy blocked overseas hosts.
final edgeRelayUrlProvider = StateProvider<String?>((ref) => null);

/// Whether Mainland China DoH + mirror fallback is preferred.
final mainlandChannelEnabledProvider = StateProvider<bool>((ref) => true);

/// Rewrites a GitHub raw URL into a prioritized Mainland-friendly mirror chain
/// (`jsdelivr` -> `fastly.jsdelivr` -> `gh-proxy` -> original URL).
List<String> githubMirrorUrls(String url) {
  final rawMatch = RegExp(
    r'^https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/([^/]+)/(.+)$',
  ).firstMatch(url);
  if (rawMatch != null) {
    final user = rawMatch.group(1)!;
    final repo = rawMatch.group(2)!;
    final branch = rawMatch.group(3)!;
    final path = rawMatch.group(4)!;
    return [
      'https://cdn.jsdelivr.net/gh/$user/$repo@$branch/$path',
      'https://fastly.jsdelivr.net/gh/$user/$repo@$branch/$path',
      'https://gh-proxy.com/$url',
      url,
    ];
  }
  if (url.startsWith('https://github.com/')) {
    return ['https://gh-proxy.com/$url', url];
  }
  return [url];
}

/// Applies an optional edge relay prefix (e.g. `https://proxy.example.workers.dev/?url=`)
/// to [targetUrl] when configured by the user.
String applyEdgeRelay(String targetUrl, String? relayBase) {
  final base = relayBase?.trim() ?? '';
  if (base.isEmpty) return targetUrl;
  final encoded = Uri.encodeComponent(targetUrl);
  if (base.contains('{url}')) {
    return base.replaceAll('{url}', encoded);
  }
  if (base.endsWith('=') || base.endsWith('?')) {
    return '$base$encoded';
  }
  return '${base.endsWith('/') ? base : '$base/'}?url=$encoded';
}

/// Lightweight IP-literal DoH resolver using Mainland-reachable AliDNS (`223.5.5.5`)
/// and DNSPod (`1.12.12.12`) JSON APIs to bypass ISP DNS poisoning.
class MainlandDohResolver {
  MainlandDohResolver({Dio? dio}) : _dio = dio ?? Dio();

  final Dio _dio;
  final Map<String, ({String ip, DateTime expiresAt})> _cache = {};

  static const List<String> endpoints = [
    'https://223.5.5.5/resolve',
    'https://1.12.12.12/resolve',
  ];

  Future<String?> resolveA(String host) async {
    final normalized = host.trim().toLowerCase();
    if (normalized.isEmpty) return null;
    final cached = _cache[normalized];
    if (cached != null && DateTime.now().isBefore(cached.expiresAt)) {
      return cached.ip;
    }
    for (final endpoint in endpoints) {
      try {
        final res = await _dio.get<Map<String, dynamic>>(
          endpoint,
          queryParameters: {'name': normalized, 'type': 'A'},
          options: Options(
            sendTimeout: const Duration(seconds: 3),
            receiveTimeout: const Duration(seconds: 3),
          ),
        );
        final answers = res.data?['Answer'];
        if (answers is List) {
          for (final ans in answers) {
            if (ans is Map && (ans['type'] == 1 || ans['type'] == 'A')) {
              final ip = '${ans['data'] ?? ''}'.trim();
              if (ip.isNotEmpty) {
                final ttl = (ans['TTL'] as num?)?.toInt() ?? 120;
                _cache[normalized] = (
                  ip: ip,
                  expiresAt: DateTime.now().add(Duration(seconds: ttl.clamp(30, 600))),
                );
                return ip;
              }
            }
          }
        }
      } catch (_) {
        // Try next Mainland DoH endpoint.
      }
    }
    return null;
  }
}

/// Local loopback HTTP/HTTPS `CONNECT` proxy that resolves hostnames via
/// Mainland-reachable DoH (`223.5.5.5` / `1.12.12.12`) while letting Dart's
/// `HttpClient` perform full native TLS SNI + certificate validation.
class MainlandDohProxy {
  MainlandDohProxy({MainlandDohResolver? resolver})
      : _resolver = resolver ?? MainlandDohResolver();

  static final MainlandDohProxy instance = MainlandDohProxy();

  final MainlandDohResolver _resolver;
  ServerSocket? _server;

  int? get port => _server?.port;

  Future<int> start() async {
    if (_server != null) return _server!.port;
    final srv = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    _server = srv;
    srv.listen(_handleClient);
    return srv.port;
  }

  Future<void> stop() async {
    await _server?.close();
    _server = null;
  }

  static bool _isFakeOrPrivateIpv4(InternetAddress addr) {
    if (addr.type != InternetAddressType.IPv4) return false;
    final b = addr.rawAddress;
    if (b.length != 4) return false;
    // 198.18.0.0/15 — RFC 2544 benchmark range used by Clash/sing-box/v2ray TUN Fake-IP
    if (b[0] == 198 && (b[1] == 18 || b[1] == 19)) return true;
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8
    if (b[0] == 10 || b[0] == 127) return true;
    if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return true;
    if (b[0] == 192 && b[1] == 168) return true;
    return false;
  }

  Future<Socket> _connectUpstream(String host, int port) async {
    // 1. Check system DNS first. Under VPN/TUN (Fake-IP or Redir-Host), system
    //    DNS returns a tunnel-routable address (e.g. 198.18.x.x) that MUST NOT
    //    be bypassed via Mainland DoH.
    List<InternetAddress> sysAddrs = const [];
    try {
      sysAddrs = await InternetAddress.lookup(host)
          .timeout(const Duration(seconds: 3));
    } catch (_) {}

    if (sysAddrs.any(_isFakeOrPrivateIpv4)) {
      return Socket.connect(
        sysAddrs.firstWhere(_isFakeOrPrivateIpv4),
        port,
        timeout: const Duration(seconds: 10),
      );
    }

    if (sysAddrs.isNotEmpty) {
      try {
        return await Socket.connect(
          sysAddrs.first,
          port,
          timeout: const Duration(seconds: 5),
        );
      } catch (_) {
        // Fall through to Mainland DoH in case system DNS was poisoned.
      }
    }

    // 2. Fallback to Mainland DoH (AliDNS / DNSPod) to bypass ISP DNS poisoning.
    final resolvedIp = await _resolver.resolveA(host);
    if (resolvedIp != null && resolvedIp.isNotEmpty) {
      return Socket.connect(
        resolvedIp,
        port,
        timeout: const Duration(seconds: 10),
      );
    }

    return Socket.connect(
      host,
      port,
      timeout: const Duration(seconds: 10),
    );
  }

  void _handleClient(Socket client) {
    final buf = <int>[];
    Socket? upstream;
    late StreamSubscription<List<int>> sub;

    sub = client.listen(
      (chunk) async {
        if (upstream != null) {
          upstream!.add(chunk);
          return;
        }
        buf.addAll(chunk);
        final headerText = latin1.decode(buf, allowInvalid: true);
        final headerEnd = headerText.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;

        sub.pause();
        try {
          final firstLineEnd = headerText.indexOf('\r\n');
          if (firstLineEnd < 0) {
            client.destroy();
            return;
          }
          final parts = headerText.substring(0, firstLineEnd).split(' ');
          if (parts.length < 3) {
            client.destroy();
            return;
          }
          final method = parts[0].toUpperCase();
          final targetArg = parts[1];
          final leftover = buf.sublist(headerEnd + 4);

          if (method == 'CONNECT') {
            final colon = targetArg.lastIndexOf(':');
            final host = colon > 0 ? targetArg.substring(0, colon) : targetArg;
            final port = colon > 0
                ? (int.tryParse(targetArg.substring(colon + 1)) ?? 443)
                : 443;
            upstream = await _connectUpstream(host, port);
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (leftover.isNotEmpty) upstream!.add(leftover);
          } else {
            final uri = Uri.tryParse(targetArg);
            if (uri == null || uri.host.isEmpty) {
              client.write('HTTP/1.1 400 Bad Request\r\n\r\n');
              client.destroy();
              return;
            }
            final host = uri.host;
            final port = uri.hasPort ? uri.port : (uri.scheme == 'https' ? 443 : 80);
            upstream = await _connectUpstream(host, port);
            final relPath = uri.path.isEmpty ? '/' : uri.path;
            final fullPath = uri.hasQuery ? '$relPath?${uri.query}' : relPath;
            final rebuiltHead =
                '$method $fullPath ${parts[2]}${headerText.substring(firstLineEnd, headerEnd + 4)}';
            upstream!.add(latin1.encode(rebuiltHead));
            if (leftover.isNotEmpty) upstream!.add(leftover);
          }

          upstream!.listen(
            client.add,
            onDone: client.destroy,
            onError: (_) => client.destroy(),
          );
          sub.resume();
        } catch (_) {
          try {
            client.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          } catch (_) {}
          client.destroy();
        }
      },
      onDone: () => upstream?.destroy(),
      onError: (_) => upstream?.destroy(),
    );
  }
}

/// Global [HttpOverrides] routing domain requests through [MainlandDohProxy]
/// when Mainland DoH mode is enabled, while respecting system proxies and
/// keeping localhost / IP literals direct.
class MainlandHttpOverrides extends HttpOverrides {
  MainlandHttpOverrides({MainlandDohProxy? proxy})
      : _proxy = proxy ?? MainlandDohProxy.instance;

  static bool enabled = true;

  final MainlandDohProxy _proxy;

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = super.createHttpClient(context);
    client.findProxy = (Uri uri) {
      // Respect explicit system HTTP proxy (e.g. Clash/v2ray/Wi-Fi proxy).
      final envProxy = HttpClient.findProxyFromEnvironment(uri);
      if (envProxy != 'DIRECT') return envProxy;
      final port = _proxy.port;
      if (!enabled || port == null) return 'DIRECT';
      final host = uri.host;
      if (host.isEmpty ||
          host == 'localhost' ||
          InternetAddress.tryParse(host) != null) {
        return 'DIRECT';
      }
      return 'PROXY 127.0.0.1:$port';
    };
    return client;
  }
}
