import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanTitle, episodeKey, findPlayableAlternative, pickEpisode } from './source-fallback';

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
  const line = (lineId: string, lineName: string, numbers: number[]) =>
    numbers.map(no => ({ id: `${lineId}-${no}`, title: `${lineName}·第${no}集`, lineId, lineName, chapterNo: no }));

  it('matches the real episode number instead of a global position', () => {
    const current = [...line('line-1', 'A', [1, 2, 3]), ...line('line-2', 'B', [1, 2, 3])];
    const target = [{ id: 'x1', title: '第1集', chapterNo: 1 }, { id: 'x2', title: '第2集', chapterNo: 2 }, { id: 'x4', title: '第4集', chapterNo: 4 }];
    expect(pickEpisode(target, episodeKey(current, 'line-2-1')!)?.id).toBe('x1');
    expect(pickEpisode(target, episodeKey(current, 'line-2-3')!)).toBeUndefined();
  });

  it('prefers the same line name and ignores positional chapter numbers', () => {
    const target = [...line('line-1', 'A', [5]), ...line('line-2', 'B', [5])];
    expect(pickEpisode(target, { episode: 5, lineName: 'B', label: '第5集', single: false })?.id).toBe('line-2-5');
    expect(pickEpisode([{ id: 'p', title: '正片', chapterNo: 4 }], { episode: 4, label: '第4集', single: false })).toBeUndefined();
  });

  it('never guesses an unknown episode by position', () => {
    const current = [{ id: 'sp', title: 'SP' }, { id: 'e1', title: '第1集' }];
    const key = episodeKey(current, 'sp')!;
    expect(pickEpisode([{ id: 'other', title: 'OVA' }, { id: 'one', title: '第1集' }], key)).toBeUndefined();
    expect(pickEpisode([{ id: 'same', title: 'SP' }], key)?.id).toBe('same');
    expect(episodeKey(current, 'missing')).toBeUndefined();
  });

  it('reads duplicate chapter ids only through the requested line', () => {
    const current = [
      { id: 'same', title: '第1集', lineId: 'a', lineName: 'A' }, { id: 'same', title: '第3集', lineId: 'b', lineName: 'B' },
    ];
    expect(episodeKey(current, 'same', 'b')).toMatchObject({ episode: 3, lineName: 'B' });
    expect(episodeKey(current, 'same', 'a')).toMatchObject({ episode: 1, lineName: 'A' });
    expect(episodeKey(current, 'same')).toBeUndefined();
  });

  it('pairs single-chapter works even without episode numbers', () => {
    const key = episodeKey([{ id: 'm', title: '正片' }], 'm')!;
    expect(pickEpisode([{ id: 'hd', title: 'HD中字' }], key)?.id).toBe('hd');
    expect(pickEpisode([{ id: 'a', title: 'HD' }, { id: 'b', title: 'TC' }], key)).toBeUndefined();
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
  const currentChapters = { match: '/api/plugins/cur/chapters/', body: { chapters: [{ id: 'c1', title: '第1集', chapterNo: 1 }, { id: 'c2', title: '第2集', chapterNo: 2 }] } };

  it('skips failing sources and returns the first one that plays the same episode', async () => {
    const calls = stubApi([
      search,
      currentChapters,
      { match: '/api/plugins/bad/chapters/', body: { chapters: [{ id: 'b1', title: '第1集', chapterNo: 1 }, { id: 'b2', title: '第2集', chapterNo: 2 }] } },
      { match: '/api/plugins/bad/video/b2', body: { videos: [] } },
      { match: '/api/plugins/good/chapters/', body: { chapters: [{ id: 'g1', title: '第1集', chapterNo: 1 }, { id: 'g2', title: '第2集', chapterNo: 2 }] } },
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
      { match: '/api/plugins/good/chapters/', body: { chapters: [{ id: 'g2', title: '第2集', chapterNo: 2 }] } },
      { match: '/api/plugins/good/video/', body: { error: 'nope' } },
    ]);

    const result = await findPlayableAlternative({
      title: '尼古喵喵', pluginId: 'cur', mediaId: 'm-cur', chapterId: 'c2', tried: ['bad'],
    });

    expect(result).toBeNull();
  });

  it('matches the second line episode one instead of the flat position', async () => {
    stubApi([
      search,
      { match: '/api/plugins/cur/chapters/', body: { chapters: [
        { id: 'a1', title: 'A·第1集', lineId: 'line-1', lineName: 'A', chapterNo: 1 },
        { id: 'a2', title: 'A·第2集', lineId: 'line-1', lineName: 'A', chapterNo: 2 },
        { id: 'b1', title: 'B·第1集', lineId: 'line-2', lineName: 'B', chapterNo: 1 },
      ] } },
      { match: '/api/plugins/bad/chapters/', body: { chapters: [] } },
      { match: '/api/plugins/good/chapters/', body: { chapters: [{ id: 'g1', title: '第1集' }, { id: 'g2', title: '第2集' }, { id: 'g3', title: '第3集' }] } },
      { match: '/api/plugins/good/video/g1', body: { videos: [{ quality: '默认', url: 'http://v/1.mp4' }] } },
    ]);
    const result = await findPlayableAlternative({ title: '尼古喵喵', pluginId: 'cur', mediaId: 'm-cur', chapterId: 'b1', lineId: 'line-2', tried: [] });
    expect(result).toMatchObject({ pluginId: 'good', chapterId: 'g1' });
    expect(result?.lineId).toBeUndefined();
  });

  it('keeps the matched line of the alternative source for the next route', async () => {
    stubApi([
      search,
      { match: '/api/plugins/cur/chapters/', body: { chapters: [
        { id: 'same', title: '第1集', lineId: 'a' }, { id: 'same', title: '第2集', lineId: 'b' },
      ] } },
      { match: '/api/plugins/bad/chapters/', body: { chapters: [] } },
      { match: '/api/plugins/good/chapters/', body: { chapters: [
        { id: 'g1', title: '第1集', lineId: 'x' }, { id: 'g2', title: '第2集', lineId: 'y', lineName: 'Y' },
      ] } },
      { match: '/api/plugins/good/video/g2', body: { videos: [{ quality: '默认', url: 'http://v/2.mp4' }] } },
    ]);
    const result = await findPlayableAlternative({ title: '尼古喵喵', pluginId: 'cur', mediaId: 'm-cur', chapterId: 'same', lineId: 'b', tried: [] });
    expect(result).toMatchObject({ pluginId: 'good', chapterId: 'g2', lineId: 'y' });
  });

  it('gives up when the current episode cannot be located', async () => {
    stubApi([search, { match: '/api/plugins/cur/chapters/', body: { chapters: [] } }]);
    expect(await findPlayableAlternative({ title: '尼古喵喵', pluginId: 'cur', mediaId: 'm-cur', chapterId: 'zz', tried: [] })).toBeNull();
  });
});
