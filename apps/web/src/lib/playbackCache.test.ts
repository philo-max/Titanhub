import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { playbackCache } from './playbackCache';

// Mock config API_BASE
vi.mock('./config', () => ({
  API_BASE: 'http://localhost:3001',
}));

describe('playbackCache unit tests', () => {
  beforeEach(() => {
    playbackCache.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initially return null for uncached chapters', () => {
    const data = playbackCache.get('test-plugin', 'ch-1');
    expect(data).toBeNull();
  });

  it('should trigger fetch calls concurrently and store results in cache on prefetch', async () => {
    const mockVideos = { videos: [{ quality: '1080P', url: 'http://example.com/1080.mp4' }] };
    const mockComments = { comments: [{ id: '1', text: 'nice', time: 1.5, color: '#fff' }] };

    // Mock global fetch
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/video/')) {
        return Promise.resolve({
          json: () => Promise.resolve(mockVideos),
        });
      }
      if (url.includes('/danmaku/')) {
        return Promise.resolve({
          json: () => Promise.resolve(mockComments),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', fetchMock);

    await playbackCache.prefetch('plugin-1', 'media-1', 'chapter-1', 'anime');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    
    // Retrieve from cache
    const cached = playbackCache.get('plugin-1', 'chapter-1');
    expect(cached).not.toBeNull();
    expect(cached?.sources).toEqual(mockVideos.videos);
    expect(cached?.comments).toEqual(mockComments.comments);

    vi.unstubAllGlobals();
  });

  it('should fetch and cache manga images on prefetch with mediaType manga', async () => {
    const mockImages = { images: ['http://example.com/p1.jpg', 'http://example.com/p2.jpg'] };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/images/')) {
        return Promise.resolve({
          json: () => Promise.resolve(mockImages),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', fetchMock);

    await playbackCache.prefetch('plugin-1', 'media-1', 'chapter-1', 'manga');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cached = playbackCache.get('plugin-1', 'chapter-1');
    expect(cached).not.toBeNull();
    expect(cached?.images).toEqual(mockImages.images);

    vi.unstubAllGlobals();
  });

  it('should evict cache entries after TTL (10 minutes)', async () => {
    const mockVideos = { videos: [{ quality: '1080P', url: 'http://example.com/1080.mp4' }] };
    const mockComments = { comments: [] };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/video/')) return Promise.resolve({ json: () => Promise.resolve(mockVideos) });
      return Promise.resolve({ json: () => Promise.resolve(mockComments) });
    });
    vi.stubGlobal('fetch', fetchMock);

    await playbackCache.prefetch('plugin-1', 'media-1', 'chapter-1', 'anime');

    // Retrieve immediately -> should hit
    expect(playbackCache.get('plugin-1', 'chapter-1')).not.toBeNull();

    // Fast forward 11 minutes (660,000 ms)
    vi.advanceTimersByTime(11 * 60 * 1000);

    // Retrieve again -> should be expired
    expect(playbackCache.get('plugin-1', 'chapter-1')).toBeNull();

    vi.unstubAllGlobals();
  });

  it('should remove items correctly when delete is called', async () => {
    const mockVideos = { videos: [{ quality: '1080P', url: 'http://example.com/1080.mp4' }] };
    const mockComments = { comments: [] };

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/video/')) return Promise.resolve({ json: () => Promise.resolve(mockVideos) });
      return Promise.resolve({ json: () => Promise.resolve(mockComments) });
    });
    vi.stubGlobal('fetch', fetchMock);

    await playbackCache.prefetch('plugin-1', 'media-1', 'chapter-1', 'anime');
    expect(playbackCache.get('plugin-1', 'chapter-1')).not.toBeNull();

    playbackCache.delete('plugin-1', 'chapter-1');
    expect(playbackCache.get('plugin-1', 'chapter-1')).toBeNull();

    vi.unstubAllGlobals();
  });
});
