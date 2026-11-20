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
