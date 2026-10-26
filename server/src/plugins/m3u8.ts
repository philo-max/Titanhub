/**
 * M3U8 Parser & Ad Filter
 * Ported from Kazumi's m3u8_parser.dart and m3u8_ad_filter.dart
 * Filters ad segments from HLS playlists using discontinuity group analysis.
 */

import { fetchWithValidatedTransport, isSafeUrl } from './sandbox';

const FETCH_TIMEOUT_MS = 10000;
const MAX_M3U8_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB maximum
const MAX_REDIRECTS = 5;
const MAX_HEURISTIC_REMOVAL_RATIO = 0.25;
const DOMINANT_PATH_RATIO = 0.8;
const FILTER_ROUTE = 'filter?url=';

export interface M3u8Segment {
  duration: number;
  uri: string;
  discontinuityGroup: number;
}

export interface M3u8Variant {
  bandwidth: number;
  resolution?: string;
  uri: string;
}

export interface M3u8MasterPlaylist {
  variants: M3u8Variant[];
  bestVariant: M3u8Variant;
}

export interface M3u8MediaPlaylist {
  segments: M3u8Segment[];
  targetDuration: number;
  isVod: boolean;
}

export type M3u8Type = 'master' | 'media';

export class M3u8Parser {
  static detectType(content: string): M3u8Type {
    if (content.includes('#EXT-X-STREAM-INF')) {
      return 'master';
    }
    return 'media';
  }

  static parseMaster(content: string): M3u8MasterPlaylist {
    const variants: M3u8Variant[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const attrs = this.parseAttributes(line.substring('#EXT-X-STREAM-INF:'.length));
        const bandwidth = parseInt(attrs.BANDWIDTH || '0');
        const resolution = attrs.RESOLUTION;
        const uri = (lines[i + 1] || '').trim();
        if (uri && !uri.startsWith('#')) {
          variants.push({ bandwidth, resolution, uri });
        }
      }
    }

    const bestVariant = variants.reduce(
      (a, b) => (a.bandwidth > b.bandwidth ? a : b),
      variants[0] || { bandwidth: 0, uri: '' }
    );

    return { variants, bestVariant };
  }

  static parseMedia(content: string): M3u8MediaPlaylist {
    const segments: M3u8Segment[] = [];
    const lines = content.split('\n');
    let targetDuration = 0;
    let isVod = false;
    let currentDuration = 0;
    let discontinuityGroup = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseInt(trimmed.substring('#EXT-X-TARGETDURATION:'.length));
      } else if (trimmed === '#EXT-X-ENDLIST') {
        isVod = true;
      } else if (trimmed === '#EXT-X-DISCONTINUITY') {
        discontinuityGroup++;
      } else if (trimmed.startsWith('#EXTINF:')) {
        const parts = trimmed.substring('#EXTINF:'.length).split(',');
        currentDuration = parseFloat(parts[0]) || 0;
      } else if (trimmed && !trimmed.startsWith('#')) {
        segments.push({
          duration: currentDuration,
          uri: trimmed,
          discontinuityGroup,
        });
        currentDuration = 0;
      }
    }

    return { segments, targetDuration, isVod };
  }

  private static parseAttributes(str: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]+)/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
      let value = match[2];
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      attrs[match[1]] = value;
    }
    return attrs;
  }
}

/**
 * Filter ad segments from a media playlist.
 * Mimics FFmpeg hls_ad_filter behavior using discontinuity groups.
 * Ported from Kazumi's M3u8AdFilter.
 */
export class M3u8AdFilter {
  static filterAds(segments: M3u8Segment[]): M3u8Segment[] {
    if (segments.length === 0) return segments;

    // Group segments by discontinuityGroup
    const groups = new Map<number, M3u8Segment[]>();
    for (const seg of segments) {
      if (!groups.has(seg.discontinuityGroup)) {
        groups.set(seg.discontinuityGroup, []);
      }
      groups.get(seg.discontinuityGroup)!.push(seg);
    }

    // Only one group means no ads detected
    if (groups.size <= 1) return segments;

    // Calculate total duration per group
    const groupDurations = new Map<number, number>();
    for (const [groupId, segs] of groups) {
      groupDurations.set(
        groupId,
        segs.reduce((sum, seg) => sum + seg.duration, 0)
      );
    }

    // Find the longest group as the "main content" reference
    let maxDuration = 0;
    for (const d of groupDurations.values()) {
      if (d > maxDuration) maxDuration = d;
    }

    // Identify ad groups
    const adGroups = new Set<number>();
    const sortedKeys = [...groups.keys()].sort((a, b) => a - b);

    for (const groupId of sortedKeys) {
      const groupDuration = groupDurations.get(groupId)!;

      // Skip the main content group
      if (groupDuration === maxDuration) continue;

      let isAd = false;

      // Short segments relative to main content (< 30%)
      if (groupDuration < maxDuration * 0.3) {
        isAd = true;
      }

      // First or last group with short duration (< 30s)
      if (
        (groupId === sortedKeys[0] || groupId === sortedKeys[sortedKeys.length - 1]) &&
        groupDuration < 30.0
      ) {
        isAd = true;
      }

      // Very short segments (< 10s) are almost certainly ads
      if (groupDuration < 10.0) {
        isAd = true;
      }

      if (isAd) {
        adGroups.add(groupId);
      }
    }

    const foreign = this.foreignPathGroups(groups);
    for (const groupId of foreign) {
      adGroups.add(groupId);
    }

    if (adGroups.size === 0) return segments;

    const totalDuration = [...groupDurations.values()].reduce((sum, d) => sum + d, 0);
    const removedByDuration = [...adGroups]
      .filter((groupId) => !foreign.has(groupId))
      .reduce((sum, groupId) => sum + groupDurations.get(groupId)!, 0);
    if (removedByDuration > totalDuration * MAX_HEURISTIC_REMOVAL_RATIO) {
      if (foreign.size === 0) return segments;
      return segments.filter((seg) => !foreign.has(seg.discontinuityGroup));
    }

    // Remove ad segments
    return segments.filter((seg) => !adGroups.has(seg.discontinuityGroup));
  }

  private static pathSignature(uri: string): string {
    const withoutQuery = uri.split(/[?#]/)[0];
    return withoutQuery.slice(0, withoutQuery.lastIndexOf('/') + 1);
  }

  private static foreignPathGroups(groups: Map<number, M3u8Segment[]>): Set<number> {
    const durationBySignature = new Map<string, number>();
    let total = 0;
    for (const segs of groups.values()) {
      for (const seg of segs) {
        const signature = this.pathSignature(seg.uri);
        durationBySignature.set(signature, (durationBySignature.get(signature) || 0) + seg.duration);
        total += seg.duration;
      }
    }
    let dominant = '';
    let dominantDuration = 0;
    for (const [signature, duration] of durationBySignature) {
      if (duration > dominantDuration) {
        dominant = signature;
        dominantDuration = duration;
      }
    }
    const foreign = new Set<number>();
    if (total === 0 || dominantDuration < total * DOMINANT_PATH_RATIO) return foreign;
    for (const [groupId, segs] of groups) {
      if (segs.every((seg) => this.pathSignature(seg.uri) !== dominant)) foreign.add(groupId);
    }
    return foreign;
  }

  /**
   * Reconstruct a filtered m3u8 media playlist string.
   */
  static rebuildPlaylist(
    segments: M3u8Segment[],
    targetDuration: number,
    isVod: boolean
  ): string {
    const lines: string[] = ['#EXTM3U'];
    lines.push(`#EXT-X-TARGETDURATION:${Math.ceil(targetDuration)}`);
    lines.push('#EXT-X-VERSION:3');
    lines.push('#EXT-X-MEDIA-SEQUENCE:0');

    for (const seg of segments) {
      lines.push(`#EXTINF:${seg.duration.toFixed(3)},`);
      lines.push(seg.uri);
    }

    if (isVod) {
      lines.push('#EXT-X-ENDLIST');
    }

    return lines.join('\n');
  }

  /**
   * One-shot: securely fetch an m3u8 URL with SSRF protection, filter ads, and return the cleaned playlist.
   */
  static async filterFromUrl(url: string): Promise<string> {
    let currentUrl = url;
    let redirectCount = 0;
    let content = '';

    while (redirectCount <= MAX_REDIRECTS) {
      const isSafe = await isSafeUrl(currentUrl, { allowPinnedFakeIp: true });
      if (!isSafe) {
        throw new Error(`SecurityError: Target URL '${currentUrl}' is blocked by security policy.`);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const res = await fetchWithValidatedTransport(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Titanhub/1.0 (HLS AdFilter)',
            Accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, text/plain, */*',
          },
        });

        // Handle HTTP redirects securely
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get('location');
          if (!location) {
            throw new Error(`Redirect response (${res.status}) missing Location header.`);
          }
          currentUrl = new URL(location, currentUrl).toString();
          redirectCount++;
          continue;
        }

        if (!res.ok) {
          throw new Error(`Failed to fetch M3U8: HTTP ${res.status} ${res.statusText}`);
        }

        // Check Content-Length header if available
        const contentLength = res.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_M3U8_SIZE_BYTES) {
          throw new Error(`M3U8 playlist exceeds maximum allowed size (${MAX_M3U8_SIZE_BYTES} bytes).`);
        }

        // Stream and cap response body size
        if (res.body) {
          const reader = res.body.getReader();
          const chunks: Uint8Array[] = [];
          let totalBytes = 0;

          let isDone = false;
          while (!isDone) {
            const { done, value } = await reader.read();
            if (done) {
              isDone = true;
              break;
            }
            if (value) {
              totalBytes += value.length;
              if (totalBytes > MAX_M3U8_SIZE_BYTES) {
                reader.cancel();
                throw new Error(`M3U8 playlist exceeds maximum allowed size (${MAX_M3U8_SIZE_BYTES} bytes).`);
              }
              chunks.push(value);
            }
          }

          const decoder = new TextDecoder('utf-8');
          content = chunks.map((c) => decoder.decode(c, { stream: true })).join('') + decoder.decode();
        } else {
          content = await res.text();
        }

        break;
      } finally {
        clearTimeout(timer);
      }
    }

    if (redirectCount > MAX_REDIRECTS) {
      throw new Error('Too many redirects while fetching M3U8 playlist.');
    }

    if (!content.trimStart().startsWith('#EXTM3U')) {
      throw new Error('Upstream response is not an HLS playlist.');
    }

    return M3u8Parser.detectType(content) === 'master'
      ? this.rewriteMaster(content, currentUrl)
      : this.rewriteMedia(content, currentUrl);
  }

  private static absolutizeUri(uri: string, baseUrl: string): string {
    try {
      return new URL(uri, baseUrl).href;
    } catch {
      return uri;
    }
  }

  private static rewriteTagUri(line: string, baseUrl: string, routeThroughFilter: boolean): string {
    return line.replace(/URI="([^"]*)"/, (_match, uri: string) => {
      const absolute = this.absolutizeUri(uri, baseUrl);
      return `URI="${routeThroughFilter ? FILTER_ROUTE + encodeURIComponent(absolute) : absolute}"`;
    });
  }

  static rewriteMaster(content: string, baseUrl: string): string {
    return content
      .split(/\r?\n/)
      .map((raw) => {
        const line = raw.trim();
        if (!line) return line;
        if (line.startsWith('#EXT-X-MEDIA:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
          return this.rewriteTagUri(line, baseUrl, true);
        }
        if (line.startsWith('#')) return this.rewriteTagUri(line, baseUrl, false);
        return FILTER_ROUTE + encodeURIComponent(this.absolutizeUri(line, baseUrl));
      })
      .join('\n');
  }

  static rewriteMedia(content: string, baseUrl: string): string {
    const playlist = M3u8Parser.parseMedia(content);
    const kept = new Set(this.filterAds(playlist.segments));
    const segmentTags = ['#EXTINF', '#EXT-X-BYTERANGE', '#EXT-X-PROGRAM-DATE-TIME', '#EXT-X-GAP', '#EXT-X-BITRATE'];
    const output: string[] = [];
    let pending: string[] = [];
    let segmentIndex = 0;
    let pendingDiscontinuity = false;
    let emittedSegment = false;

    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line === '#EXT-X-DISCONTINUITY') {
        pendingDiscontinuity = true;
      } else if (segmentTags.some((tag) => line.startsWith(tag))) {
        pending.push(line);
      } else if (line.startsWith('#')) {
        output.push(this.rewriteTagUri(line, baseUrl, false));
      } else {
        const segment = playlist.segments[segmentIndex++];
        if (segment && kept.has(segment)) {
          if (pendingDiscontinuity && emittedSegment) output.push('#EXT-X-DISCONTINUITY');
          output.push(...pending, this.absolutizeUri(line, baseUrl));
          pendingDiscontinuity = false;
          emittedSegment = true;
        }
        pending = [];
      }
    }

    return output.join('\n');
  }
}
