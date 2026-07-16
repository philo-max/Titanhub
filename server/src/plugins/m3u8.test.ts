import { describe, it, expect } from 'vitest';
import { M3u8Parser, M3u8AdFilter } from './m3u8';

const SAMPLE_MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=720x480
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2560000,RESOLUTION=1280x720
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=768000,RESOLUTION=640x360
480p.m3u8
#EXT-X-ENDLIST`;

const SAMPLE_MEDIA_WITH_ADS = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:5.000,
ad-segment-1.ts
#EXTINF:5.000,
ad-segment-2.ts
#EXT-X-DISCONTINUITY
#EXTINF:10.000,
main-content-1.ts
#EXTINF:10.000,
main-content-2.ts
#EXTINF:10.000,
main-content-3.ts
#EXTINF:10.000,
main-content-4.ts
#EXTINF:10.000,
main-content-5.ts
#EXTINF:10.000,
main-content-6.ts
#EXT-X-DISCONTINUITY
#EXTINF:3.000,
outro-ad-1.ts
#EXTINF:3.000,
outro-ad-2.ts
#EXT-X-ENDLIST`;

const SAMPLE_MEDIA_NO_ADS = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.000,
segment-1.ts
#EXTINF:10.000,
segment-2.ts
#EXTINF:10.000,
segment-3.ts
#EXT-X-ENDLIST`;

describe('M3u8Parser', () => {
  it('should detect master vs media playlists', () => {
    expect(M3u8Parser.detectType(SAMPLE_MASTER)).toBe('master');
    expect(M3u8Parser.detectType(SAMPLE_MEDIA_WITH_ADS)).toBe('media');
  });

  it('should parse master playlist with variants', () => {
    const master = M3u8Parser.parseMaster(SAMPLE_MASTER);
    expect(master.variants).toHaveLength(3);
    expect(master.bestVariant.bandwidth).toBe(2560000);
    expect(master.bestVariant.uri).toBe('1080p.m3u8');
  });

  it('should parse media playlist with segments and discontinuity groups', () => {
    const media = M3u8Parser.parseMedia(SAMPLE_MEDIA_WITH_ADS);
    expect(media.segments).toHaveLength(10);
    expect(media.isVod).toBe(true);
    expect(media.targetDuration).toBe(10);

    // Group 0: ad segments (2 segments, 10s total)
    // Group 1: main content (6 segments, 60s total)
    // Group 2: outro ads (2 segments, 6s total)
    expect(media.segments[0].discontinuityGroup).toBe(0);
    expect(media.segments[2].discontinuityGroup).toBe(1);
    expect(media.segments[8].discontinuityGroup).toBe(2);
  });

  it('should handle media playlist without discontinuities', () => {
    const media = M3u8Parser.parseMedia(SAMPLE_MEDIA_NO_ADS);
    expect(media.segments).toHaveLength(3);
    expect(media.segments.every((s) => s.discontinuityGroup === 0)).toBe(true);
  });
});

describe('M3u8AdFilter', () => {
  it('should filter ad segments from playlist with discontinuities', () => {
    const media = M3u8Parser.parseMedia(SAMPLE_MEDIA_WITH_ADS);
    const filtered = M3u8AdFilter.filterAds(media.segments);

    // Should remove group 0 (10s, < 30% of 60s) and group 2 (6s, < 10s)
    // Should keep group 1 (main content, 60s)
    expect(filtered.length).toBe(6);
    expect(filtered.every((s) => s.discontinuityGroup === 1)).toBe(true);
    expect(filtered[0].uri).toBe('main-content-1.ts');
  });

  it('should not filter when only one group exists', () => {
    const media = M3u8Parser.parseMedia(SAMPLE_MEDIA_NO_ADS);
    const filtered = M3u8AdFilter.filterAds(media.segments);
    expect(filtered.length).toBe(3); // No change
  });

  it('should rebuild a valid m3u8 playlist after filtering', () => {
    const media = M3u8Parser.parseMedia(SAMPLE_MEDIA_WITH_ADS);
    const filtered = M3u8AdFilter.filterAds(media.segments);
    const rebuilt = M3u8AdFilter.rebuildPlaylist(filtered, media.targetDuration, media.isVod);

    expect(rebuilt).toContain('#EXTM3U');
    expect(rebuilt).toContain('#EXT-X-TARGETDURATION:10');
    expect(rebuilt).toContain('main-content-1.ts');
    expect(rebuilt).not.toContain('ad-segment-1.ts');
    expect(rebuilt).not.toContain('outro-ad-1.ts');
    expect(rebuilt).toContain('#EXT-X-ENDLIST');
  });
});
