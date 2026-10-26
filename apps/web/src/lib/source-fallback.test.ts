import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanTitle, findPlayableAlternative, pickEpisode } from './source-fallback';

vi.mock('./config', () => ({ API_BASE: 'http://api.test' }));

interface Route { match: string; body: unknown }

function stubApi(routes: Route[]) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url.replace('http://api.test', ''));
    const route = routes.find(entry => url.includes(entry.match));
    if (!route) throw new Error(`unexpected ${url}`);
    return { json: async () => route.body };
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cleanTitle', () => {
  it('extracts the title from a quoted page title', () => {
    expect(cleanTitle('《进击的巨人》番剧高清完整版在线观看_进击的巨人高清完整版下载-月之祠')).toBe('进击的巨人');
  });

  it('cuts site suffixes and keeps plain titles', () => {
    expect(cleanTitle('尼古喵喵 - 某某动漫站')).toBe('尼古喵喵');
    expect(cleanTitle('尼古喵喵')).toBe('尼古喵喵');
  });
});

describe('pickEpisode', () => {
  it('prefers the matching chapter number and falls back to the index', () => {
    const chapters = [{ id: 'a', chapterNo: 3 }, { id: 'b', chapterNo: 4 }];
    expect(pickEpisode(chapters, 4, 0)?.id).toBe('b');
    expect(pickEpisode([{ id: 'x' }, { id: 'y' }], 9, 1)?.id).toBe('y');
  });
});

describe('findPlayableAlternative', () => {
  const search = {
    match: '/api/aggregate/search',
    body: {
      items: [{
        title: '尼古喵喵',
        sources: [
          { pluginId: 'bad', pluginName: 'Bad', mediaId: 'm-bad', providesVideo: true },
          { pluginId: 'info', pluginName: 'Info', mediaId: 'm-info', providesVideo: false },
          { pluginId: 'good', pluginName: 'Good', mediaId: 'm-good', providesVideo: true },
          { pluginId: 'cur', pluginName: 'Current', mediaId: 'm-cur', providesVideo: true },
        ],
      }],
    },
  };
  const currentChapters = { match: '/api/plugins/cur/chapters/', body: { chapters: [{ id: 'c1', chapterNo: 1 }, { id: 'c2', chapterNo: 2 }] } };

  it('skips failing sources and returns the first one that plays the same episode', async () => {
    const calls = stubApi([
      search,
      currentChapters,
      { match: '/api/plugins/bad/chapters/', body: { chapters: [{ id: 'b1', chapterNo: 1 }, { id: 'b2', chapterNo: 2 }] } },
      { match: '/api/plugins/bad/video/b2', body: { videos: [] } },
      { match: '/api/plugins/good/chapters/', body: { chapters: [{ id: 'g1', chapterNo: 1 }, { id: 'g2', chapterNo: 2 }] } },
      { match: '/api/plugins/good/video/g2', body: { videos: [{ quality: '默认', url: 'http://v/2.mp4' }] } },
    ]);
    const attempts: string[] = [];

    const result = await findPlayableAlternative({
      title: '《尼古喵喵》在线观看', pluginId: 'cur', mediaId: 'm-cur', chapterId: 'c2', tried: [],
      onAttempt: (source, attempt, total) => attempts.push(`${source.pluginId} ${attempt}/${total}`),
    });

    expect(result).toMatchObject({ pluginId: 'good', mediaId: 'm-good', chapterId: 'g2', videos: [{ url: 'http://v/2.mp4' }] });
    expect(attempts).toEqual(['bad 1/2', 'good 2/2']);
    expect(calls.some(call => call.includes('/video/c2'))).toBe(false);
  });

  it('does not retry sources that were already tried and returns null when none plays', async () => {
    stubApi([
      search,
      currentChapters,
      { match: '/api/plugins/good/chapters/', body: { chapters: [{ id: 'g2', chapterNo: 2 }] } },
      { match: '/api/plugins/good/video/', body: { error: 'nope' } },
    ]);

    const result = await findPlayableAlternative({
      title: '尼古喵喵', pluginId: 'cur', mediaId: 'm-cur', chapterId: 'c2', tried: ['bad'],
    });

    expect(result).toBeNull();
  });

  it('gives up when the current episode cannot be located', async () => {
    stubApi([search, { match: '/api/plugins/cur/chapters/', body: { chapters: [] } }]);
    expect(await findPlayableAlternative({ title: '尼古喵喵', pluginId: 'cur', mediaId: 'm-cur', chapterId: 'zz', tried: [] })).toBeNull();
  });
});
