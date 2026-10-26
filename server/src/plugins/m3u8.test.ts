import { describe, it, expect, vi } from 'vitest';
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

  it('keeps a full episode whose scenes are split by many discontinuities', () => {
    const groups = Array.from({ length: 60 }, (_, group) =>
      `${group ? '#EXT-X-DISCONTINUITY\n' : ''}#EXTINF:${group === 30 ? 80 : group % 7 === 0 ? 5 : 20}.000,\nhttps://cdn.example/ep1/hls/s${group}.ts`
    ).join('\n');
    const playlist = `#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXT-X-DISCONTINUITY\n${groups}\n#EXT-X-ENDLIST`;
    const media = M3u8Parser.parseMedia(playlist);
    expect(M3u8AdFilter.filterAds(media.segments)).toHaveLength(60);
  });

  it('removes inserted ads served from a foreign path even when scene splits block the duration heuristic', () => {
    const content = Array.from({ length: 40 }, (_, i) => `#EXTINF:20.000,\nhttps://cdn.example/ep1/hls/s${i}.ts\n#EXT-X-DISCONTINUITY`).join('\n');
    const playlist = `#EXTM3U\n#EXT-X-TARGETDURATION:20\n#EXTINF:5.000,\nhttps://ads.example/adjump/a1.ts\n#EXT-X-DISCONTINUITY\n${content}\n#EXT-X-ENDLIST`;
    const filtered = M3u8AdFilter.filterAds(M3u8Parser.parseMedia(playlist).segments);
    expect(filtered).toHaveLength(40);
    expect(filtered.some((s) => s.uri.includes('adjump'))).toBe(false);
  });

  it('rewrites media playlists with absolute URIs and preserves key, map and discontinuity state', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-KEY:METHOD=AES-128,URI="../keys/k1.key",IV=0x1
#EXT-X-MAP:URI="init.mp4"
#EXTINF:10.000,
#EXT-X-BYTERANGE:100@0
part-1.m4s
#EXT-X-DISCONTINUITY
#EXTINF:10.000,
part-2.m4s?token=a
#EXT-X-ENDLIST`;
    const rewritten = M3u8AdFilter.rewriteMedia(playlist, 'https://cdn.example/v/1/index.m3u8?sig=x');
    expect(rewritten).toContain('#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/v/keys/k1.key",IV=0x1');
    expect(rewritten).toContain('#EXT-X-MAP:URI="https://cdn.example/v/1/init.mp4"');
    expect(rewritten).toContain('#EXT-X-BYTERANGE:100@0\nhttps://cdn.example/v/1/part-1.m4s');
    expect(rewritten).toContain('#EXT-X-DISCONTINUITY\n#EXTINF:10.000,\nhttps://cdn.example/v/1/part-2.m4s?token=a');
    expect(rewritten.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });

  it('routes master variants and renditions back through the filter with absolute targets', () => {
    const master = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/zh.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1280000,AUDIO="a"
720p/index.m3u8`;
    const rewritten = M3u8AdFilter.rewriteMaster(master, 'https://cdn.example/show/master.m3u8');
    expect(rewritten).toContain(`URI="filter?url=${encodeURIComponent('https://cdn.example/show/audio/zh.m3u8')}"`);
    expect(rewritten).toContain(`filter?url=${encodeURIComponent('https://cdn.example/show/720p/index.m3u8')}`);
    expect(new URL(rewritten.split('\n')[3], 'http://127.0.0.1:3001/api/m3u8/filter?url=x').pathname).toBe('/api/m3u8/filter');
  });

  describe('filterFromUrl security and SSRF protection', () => {
    it('rejects upstream responses that are not HLS playlists', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('<html>blocked</html>', { status: 200 }));
      try {
        await expect(M3u8AdFilter.filterFromUrl('http://example.com/stream.m3u8')).rejects.toThrow(/not an HLS playlist/);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('revalidates redirect targets before fetching them', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
      );
      try {
        await expect(M3u8AdFilter.filterFromUrl('http://example.com/stream.m3u8')).rejects.toThrow(/blocked by security policy/);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('blocks cloud metadata endpoint (169.254.169.254)', async () => {
      await expect(
        M3u8AdFilter.filterFromUrl('http://169.254.169.254/latest/meta-data/')
      ).rejects.toThrow(/blocked by security policy/i);
    });

    it('blocks file:// protocol and non-http(s) schemes', async () => {
      await expect(
        M3u8AdFilter.filterFromUrl('file:///etc/passwd')
      ).rejects.toThrow(/blocked by security policy/i);
    });

    it('blocks private network IP ranges', async () => {
      await expect(
        M3u8AdFilter.filterFromUrl('http://10.0.0.1/stream.m3u8')
      ).rejects.toThrow(/blocked by security policy/i);

      await expect(
        M3u8AdFilter.filterFromUrl('http://192.168.1.1/stream.m3u8')
      ).rejects.toThrow(/blocked by security policy/i);
    });

    it('fetches and filters remote valid media playlist via mock', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        new Response(SAMPLE_MEDIA_WITH_ADS, {
          status: 200,
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        })
      );

      try {
        const result = await M3u8AdFilter.filterFromUrl('http://example.com/stream.m3u8');
        expect(result).toContain('main-content-1.ts');
        expect(result).not.toContain('ad-segment-1.ts');
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
