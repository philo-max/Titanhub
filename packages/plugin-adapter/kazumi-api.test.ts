import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { adaptKazumi, type KazumiRule } from './index';

const baseRule = {
  name: 'API', baseURL: 'https://anime.example/', searchURL: '', searchList: '',
  searchName: '', searchResult: '', searchMode: 'api', chapterMode: 'api',
  searchApiConfig: {
    request: { method: 'GET', url: 'https://api.example/search', query: { wd: '@keyword' } },
    listPath: '$.list[*]', namePath: '$.name', sourcePath: '$.id',
  },
  chapterApiConfig: {
    request: { method: 'GET', url: 'https://api.example/detail/@source' }, format: 'nested',
    roadsPath: '$.sources[*]', roadNamePath: '$.name', episodesPath: '$.episodes[*]',
    episodeNamePath: '$.title', episodeUrlPath: '$.id',
    episodePage: { url: 'https://anime.example/anime/@source/play/@episodeUrl', query: {} },
  },
} as unknown as KazumiRule;

function load(rule: KazumiRule, responses: unknown[]) {
  const fetch = vi.fn(async (_url: string, _options?: unknown) => ({ text: async () => JSON.stringify(responses.shift()) }));
  const context: Record<string, any> = {};
  new Function('fetch', 'globalThis', adaptKazumi(rule).code)(fetch, context);
  return { plugin: context.plugin, fetch };
}

describe('Kazumi JSON APIs', () => {
  it('preserves numeric media identity and builds nested episode pages for every road', async () => {
    const { plugin, fetch } = load(baseRule, [
      { list: [{ id: 42, name: '测试' }] },
      { sources: [
        { name: 'A', episodes: [{ title: '一', id: 0 }] },
        { name: 'B', episodes: [{ title: '一', id: 9 }] },
      ] },
    ]);
    const results = await plugin.search('新 番&');
    expect(results).toEqual([{ id: '42', title: '测试', cover: '' }]);
    expect(fetch.mock.calls[0][0]).toBe('https://api.example/search?wd=%E6%96%B0%20%E7%95%AA%26');
    expect(await plugin.getDetail('42')).toMatchObject({ id: '42', title: '测试' });
    const chapters = await plugin.getChapters('42');
    expect(fetch.mock.calls[1][0]).toBe('https://api.example/detail/42');
    expect(chapters.map((chapter: any) => decodeURIComponent(chapter.id))).toEqual([
      'https://anime.example/anime/42/play/0', 'https://anime.example/anime/42/play/9',
    ]);
    expect(chapters.map((chapter: any) => chapter.title)).toEqual(['A·一', 'B·一']);
  });

  it('encodes JSON requests once and resolves optional covers and source templates', async () => {
    const rule = { ...baseRule, chapterMode: 'xpath', searchApiConfig: {
      ...baseRule.searchApiConfig,
      request: { method: 'POST', url: 'https://api.example/search', headers: { apikey: 'public' }, bodyType: 'json', body: { text: '@keyword', page: 1 } },
      coverPath: '$.image', sourceTemplate: 'https://anime.example/detail/@source.html',
    } } as KazumiRule;
    const { plugin, fetch } = load(rule, [{ list: [{ id: 8, name: '番', image: '//cdn.example/a.jpg' }] }]);
    expect(await plugin.search('"番&')).toEqual([{ id: encodeURIComponent('https://anime.example/detail/8.html'), title: '番', cover: 'https://cdn.example/a.jpg' }]);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { apikey: 'public', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '"番&', page: 1 }) });
  });

  it('splits delimited roads and returns direct media without fetching it as HTML', async () => {
    const rule = { ...baseRule, chapterApiConfig: {
      request: { url: 'https://api.example/detail', query: { id: '@source' } }, format: 'delimited',
      roadNamesPath: '$.info.from', roadEpisodesPath: '$.info.urls', roadSeparator: '$$$', episodeSeparator: '#', fieldSeparator: '$',
    } } as KazumiRule;
    const { plugin, fetch } = load(rule, [{ info: { from: 'A$$$B', urls: '第1集$https://cdn.example/a.m3u8?token=x$y#第2集$https://cdn.example/b.mp4$$$第1集$https://other.example/play' } }]);
    const chapters = await plugin.getChapters('42');
    expect(chapters).toHaveLength(3);
    expect(chapters[0].title).toBe('A·第1集');
    expect(await plugin.getVideoUrl(chapters[0].id)).toEqual([{ quality: '默认', url: 'https://cdn.example/a.m3u8?token=x$y' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('handles a single nested road and empty API results', async () => {
    const rule = { ...baseRule, chapterApiConfig: { ...baseRule.chapterApiConfig, roadsPath: '$.data', roadNamePath: '', episodesPath: '$.episodes[*]' } } as KazumiRule;
    const { plugin } = load(rule, [{ list: [] }, { data: { episodes: [{ title: '一', id: 1 }] } }]);
    expect(await plugin.search('missing')).toEqual([]);
    expect((await plugin.getChapters('42'))[0].title).toBe('一');
  });

  it('loads details in a new sandbox without resolving a numeric API ID as a website URL', async () => {
    const { plugin, fetch } = load(baseRule, [{ title: '独立详情', cover: '/poster.jpg' }]);
    expect(await plugin.getDetail('42')).toMatchObject({ id: '42', title: '独立详情', cover: 'https://anime.example/poster.jpg' });
    expect(fetch.mock.calls[0][0]).toBe('https://api.example/detail/42');
  });

  it('rejects incomplete API configs during import', () => {
    expect(() => adaptKazumi({ ...baseRule, searchApiConfig: undefined })).toThrow('searchApiConfig');
    expect(() => adaptKazumi({ ...baseRule, chapterApiConfig: undefined })).toThrow('chapterApiConfig');
  });

  it('resolves root-relative episode and cover URLs against the origin of a path-prefixed base', async () => {
    const rule = { ...baseRule, baseURL: 'https://anime.example/media/', searchApiConfig: { ...baseRule.searchApiConfig!, coverPath: '$.cover' }, chapterApiConfig: {
      ...baseRule.chapterApiConfig!, episodePage: undefined,
    } } as KazumiRule;
    const { plugin } = load(rule, [{ list: [{ id: 42, name: '番', cover: '/cover.jpg' }] }, { sources: [{ episodes: [{ title: '一', id: '/play/42' }] }] }]);
    expect((await plugin.search('番'))[0].cover).toBe('https://anime.example/cover.jpg');
    expect(decodeURIComponent((await plugin.getChapters('42'))[0].id)).toBe('https://anime.example/play/42');
  });

  it('propagates invalid JSON and HTTP failures', async () => {
    const context: Record<string, any> = {};
    new Function('fetch', 'globalThis', adaptKazumi(baseRule).code)(async () => ({ ok: false, status: 503 }), context);
    await expect(context.plugin.search('test')).rejects.toThrow('HTTP 503');
    const { plugin } = load(baseRule, [undefined]);
    await expect(plugin.search('test')).rejects.toThrow();
  });

  it('rejects HTTP errors when the production sandbox provides status without ok', async () => {
    const context: Record<string, any> = {};
    new Function('fetch', 'globalThis', adaptKazumi(baseRule).code)(async () => ({ status: 403, text: async () => '<html>Forbidden</html>' }), context);
    await expect(context.plugin.search('test')).rejects.toThrow('Kazumi API HTTP 403');
  });
});

const official = JSON.parse(readFileSync(new URL('./kazumi-official.fixture.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '')) as { rules: KazumiRule[] };

describe('official Kazumi maintained catalog', () => {
  it('contains the 17 maintained rules from the frozen upstream catalog', () => {
    expect(official.rules).toHaveLength(17);
    expect(official.rules.filter(rule => rule.searchMode === 'api')).toHaveLength(8);
  });

  it.each(official.rules)('imports $name and compiles executable plugin source', rule => {
    const adapted = adaptKazumi(rule);
    expect(() => new Function(adapted.code)).not.toThrow();
  });

  it.each(official.rules.filter(rule => rule.searchMode === 'api'))('executes real search configuration for $name', async rule => {
    const item = { id: 42, name: '测试番', title: '测试番', vod_name: '测试番', vod_id: 42 };
    const response = { list: [item], info: { rows: [item] }, data: { records: [item] } };
    const { plugin } = load(rule, [rule.name === 'xfdmnext' ? [item] : response]);
    const media = await plugin.search('测试番');
    expect(media).toHaveLength(1);
    expect(media[0].title).toBe('测试番');
    expect(media[0].id).toContain('42');
  });

  it.each(official.rules.filter(rule => rule.chapterMode === 'api'))('executes real chapter configuration for $name', async rule => {
    const episode = { title: '第1集', id: 7, episodeLabel: '第1集', episodeOrder: 7 };
    const responses: Record<string, unknown> = {
      giriGiriLove: { info: { vod_play_from: '线路A$$$线路B', vod_play_url: '第1集$https://cdn.example/a.m3u8$$$第1集$https://cdn.example/b.m3u8' } },
      sorani: { data: { episodes: [episode] } },
      xfdmnext: { sources: [{ name: '线路A', episodes: [episode] }, { name: '线路B', episodes: [{ ...episode, id: 8 }] }] },
    };
    const { plugin, fetch } = load(rule, [responses[rule.name]]);
    const chapters = await plugin.getChapters('42');
    expect(chapters.length).toBe(rule.name === 'sorani' ? 1 : 2);
    const firstUrl = decodeURIComponent(chapters[0].id);
    if (rule.name === 'sorani') expect(firstUrl).toBe('https://www.sorani.net/anime/mal/42/episode/7');
    if (rule.name === 'xfdmnext') {
      expect(firstUrl).toBe('https://next.xifanacg.com/anime/42/play/7');
      expect(fetch.mock.calls[0][1]).toMatchObject({ body: '{"p_id":"42"}' });
    }
    if (rule.name === 'giriGiriLove') expect(firstUrl).toBe('https://cdn.example/a.m3u8');
    expect(new Set(chapters.map((chapter: any) => chapter.id)).size).toBe(chapters.length);
  });
});
