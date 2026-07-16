/**
 * M3U8 Parser & Ad Filter
 * Ported from Kazumi's m3u8_parser.dart and m3u8_ad_filter.dart
 * Filters ad segments from HLS playlists using discontinuity group analysis.
 */

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
    let hasDiscontinuity = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseInt(trimmed.substring('#EXT-X-TARGETDURATION:'.length));
      } else if (trimmed === '#EXT-X-ENDLIST') {
        isVod = true;
      } else if (trimmed === '#EXT-X-DISCONTINUITY') {
        discontinuityGroup++;
        hasDiscontinuity = true;
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

    if (adGroups.size === 0) return segments;

    // Remove ad segments
    return segments.filter((seg) => !adGroups.has(seg.discontinuityGroup));
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
   * One-shot: fetch an m3u8 URL, filter ads, and return the cleaned playlist.
   */
  static async filterFromUrl(url: string): Promise<string> {
    const res = await fetch(url);
    const content = await res.text();
    const type = M3u8Parser.detectType(content);

    if (type === 'master') {
      // For master playlists, return as-is (ad filtering applies to media playlists)
      return content;
    }

    const playlist = M3u8Parser.parseMedia(content);
    const filteredSegments = this.filterAds(playlist.segments);

    return this.rebuildPlaylist(filteredSegments, playlist.targetDuration, playlist.isVod);
  }
}
