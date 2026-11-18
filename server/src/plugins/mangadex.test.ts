import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { PluginSandbox } from './sandbox';
import fs from 'fs/promises';
import path from 'path';

describe('MangaDex Plugin Sandboxed Integration', () => {
  let pluginCode = '';

  beforeAll(async () => {
    // Read the actual mangadex.js plugin code
    pluginCode = await fs.readFile(
      path.join(__dirname, 'mangadex.js'),
      'utf-8'
    );
  });

  beforeEach(() => {
    // Spy on global fetch
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    // Restore all mocked spies
    vi.restoreAllMocks();
  });

  it('performs search and parses nested relationships cover filename', async () => {
    const mockSearchResponse = {
      result: 'ok',
      data: [
        {
          id: 'manga-123',
          type: 'manga',
          attributes: {
            title: { en: 'Test Manga', ja: 'テスト漫画' },
            description: { en: 'A test manga description' }
          },
          relationships: [
            {
              type: 'cover_art',
              attributes: {
                fileName: 'cover-456.jpg'
              }
            }
          ]
        }
      ]
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify(mockSearchResponse),
    } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<any[]>('search', ['test query']);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual({
      id: 'manga-123',
      title: 'Test Manga',
      cover: 'https://uploads.mangadex.org/covers/manga-123/cover-456.jpg',
      description: 'A test manga description',
    });

    // Check fetch was called with the correct rating parameters
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('contentRating[]=safe'),
      expect.any(Object)
    );
  });

  it('identifies itself with a User-Agent on every API request', async () => {
    vi.mocked(global.fetch).mockImplementation(async () => ({
      status: 200,
      text: async () => JSON.stringify({ result: 'ok', data: [], total: 0 }),
    }) as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    await sandbox.runMethod<any[]>('search', ['ua probe']);
    await sandbox.runMethod<any[]>('getChapters', ['ua-probe']);

    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [, init] of vi.mocked(global.fetch).mock.calls) {
      expect((init as any).headers['User-Agent']).toMatch(/^Titanhub\//);
    }
  });

  it('performs explore and pulls popular list', async () => {
    const mockExploreResponse = {
      result: 'ok',
      data: [
        {
          id: 'popular-1',
          type: 'manga',
          attributes: {
            title: { en: 'Popular Manga' },
            description: { en: 'Description' }
          },
          relationships: []
        }
      ]
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify(mockExploreResponse),
    } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<any[]>('explore', ['manga']);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].title).toBe('Popular Manga');
    expect(result.data![0].cover).toContain('picsum.photos'); // Fallback cover
    expect(result.data![0].updateInfo).toBe('人气推荐');
  });

  it('gets detail and extracts author and tags', async () => {
    const mockDetailResponse = {
      result: 'ok',
      data: {
        id: 'manga-123',
        attributes: {
          title: { ja: 'ナルト' },
          status: 'ongoing',
          tags: [
            { attributes: { name: { en: 'Action' } } },
            { attributes: { name: { en: 'Adventure' } } }
          ]
        },
        relationships: [
          {
            type: 'author',
            attributes: {
              name: 'Masashi Kishimoto'
            }
          }
        ]
      }
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify(mockDetailResponse),
    } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<any>('getDetail', ['manga-123']);

    expect(result.success).toBe(true);
    expect(result.data!.title).toBe('ナルト');
    expect(result.data!.author).toBe('Masashi Kishimoto');
    expect(result.data!.genres).toEqual(['Action', 'Adventure']);
    expect(result.data!.status).toBe('连载中');
  });

  it('gets chapters and fallbacks to English if Chinese list is empty', async () => {
    const mockChineseEmptyResponse = { result: 'ok', data: [] };
    const mockEnglishResponse = {
      result: 'ok',
      data: [
        {
          id: 'chap-1',
          attributes: {
            chapter: '1.5',
            title: 'Side Story'
          }
        }
      ]
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify(mockChineseEmptyResponse),
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify(mockEnglishResponse),
      } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<any[]>('getChapters', ['manga-123']);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual({
      id: 'chap-1',
      title: '第1.5话 Side Story',
      chapterNo: 1.5
    });

    // Verify it called first for Chinese then English
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  describe('chapter feed pagination', () => {
    const tierOf = (url: URL) => url.searchParams.getAll('translatedLanguage[]').join(',');
    const chapter = (id: string, attributes: Record<string, unknown> = {}, groupName?: string) => ({
      id,
      type: 'chapter',
      attributes: { chapter: null, title: null, volume: null, translatedLanguage: 'zh', ...attributes },
      relationships: groupName ? [{ id: 'g-' + groupName, type: 'scanlation_group', attributes: { name: groupName } }] : [],
    });
    const numbered = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => chapter(`${prefix}-${i}`, { chapter: String(i + 1) }));

    function serveFeed(handler: (url: URL) => { status?: number; body: unknown }) {
      const requested: URL[] = [];
      vi.mocked(global.fetch).mockImplementation(async (input: any) => {
        const url = new URL(String(input));
        requested.push(url);
        const reply = handler(url);
        return { status: reply.status ?? 200, text: async () => JSON.stringify(reply.body) } as any;
      });
      return requested;
    }

    function pagedTiers(tiers: Record<string, unknown[]>, withTotal = true) {
      return (url: URL) => {
        const items = tiers[tierOf(url)] || [];
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Number(url.searchParams.get('limit'));
        const body: Record<string, unknown> = { result: 'ok', data: items.slice(offset, offset + limit), limit, offset };
        if (withTotal) body.total = items.length;
        return { body };
      };
    }

    async function chaptersOf(mediaId: string) {
      const sandbox = new PluginSandbox('mangadex', pluginCode);
      return sandbox.runMethod<any[]>('getChapters', [mediaId]);
    }

    it('pages through 1234 Chinese chapters with offsets and keeps every ID in order', async () => {
      const items = numbered('zh', 1234);
      const requested = serveFeed(pagedTiers({ 'zh,zh-hk': items }));
      const result = await chaptersOf('page-1234');
      expect(result.error).toBeUndefined();
      expect(result.data!.map((c) => c.id)).toEqual(items.map((c) => c.id));
      expect(requested.map((u) => u.searchParams.get('offset'))).toEqual(['0', '500', '1000']);
      for (const url of requested) {
        expect(url.searchParams.getAll('contentRating[]')).toEqual(['safe', 'suggestive']);
        expect(url.pathname).toBe('/manga/page-1234/feed');
      }
    }, 15000);

    it('stops exactly at total boundaries without an extra request', async () => {
      const requested = serveFeed(pagedTiers({ 'zh,zh-hk': numbered('b', 1000) }));
      const result = await chaptersOf('page-boundary');
      expect(result.data).toHaveLength(1000);
      expect(requested.map((u) => u.searchParams.get('offset'))).toEqual(['0', '500']);
    }, 15000);

    it('continues after a short page when total says more remain and ends on an empty page without total', async () => {
      const items = numbered('s', 700);
      const shortFirst = (url: URL) => {
        const offset = Number(url.searchParams.get('offset') || 0);
        const end = offset === 0 ? 450 : offset + 500;
        return { body: { result: 'ok', data: items.slice(offset, end), total: items.length } };
      };
      const requested = serveFeed(shortFirst);
      const result = await chaptersOf('page-short');
      expect(result.data!.map((c) => c.id)).toEqual(items.map((c) => c.id));
      expect(requested.map((u) => u.searchParams.get('offset'))).toEqual(['0', '450']);

      vi.mocked(global.fetch).mockReset();
      const noTotal = serveFeed(pagedTiers({ 'zh,zh-hk': numbered('n', 500) }, false));
      const untotalled = await chaptersOf('page-no-total');
      expect(untotalled.data).toHaveLength(500);
      expect(noTotal.map((u) => u.searchParams.get('offset'))).toEqual(['0', '500']);
    }, 15000);

    it('reports repeated pages instead of looping forever', async () => {
      const page = numbered('r', 500);
      const requested = serveFeed(() => ({ body: { result: 'ok', data: page, total: 1500 } }));
      const result = await chaptersOf('page-repeat');
      expect(result.success).toBe(false);
      expect(result.error).toContain('重复');
      expect(requested).toHaveLength(2);
    }, 15000);

    it('falls back to a fully paged English tier only when Chinese is empty', async () => {
      const english = numbered('en', 620).map((c) => ({ ...c, attributes: { ...c.attributes, translatedLanguage: 'en' } }));
      const requested = serveFeed(pagedTiers({ 'zh,zh-hk': [], en: english }));
      const result = await chaptersOf('page-fallback');
      expect(result.data!.map((c) => c.id)).toEqual(english.map((c) => c.id));
      expect(requested.map((u) => `${tierOf(u)}@${u.searchParams.get('offset')}`)).toEqual(['zh,zh-hk@0', 'en@0', 'en@500']);
    }, 15000);

    it('returns an empty list when neither language has chapters', async () => {
      const requested = serveFeed(pagedTiers({}));
      const result = await chaptersOf('page-empty');
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(requested).toHaveLength(2);
    });

    it('reports HTTP and API errors explicitly instead of returning partial chapters', async () => {
      const items = numbered('f', 900);
      serveFeed((url) => url.searchParams.get('offset') === '500'
        ? { status: 500, body: { result: 'error', errors: [{ detail: 'boom' }] } }
        : pagedTiers({ 'zh,zh-hk': items })(url));
      const failed = await chaptersOf('page-http-fail');
      expect(failed.success).toBe(false);
      expect(failed.error).toContain('HTTP 500');

      vi.mocked(global.fetch).mockReset();
      serveFeed(() => ({ body: { result: 'error', errors: [{ detail: 'bad request' }] } }));
      const invalid = await chaptersOf('page-api-fail');
      expect(invalid.success).toBe(false);
      expect(invalid.error).toContain('bad request');
    }, 15000);

    it('keeps every scanlation version and distinct volume, oneshot, decimal and zero chapters', async () => {
      const items = [
        chapter('c0', { chapter: '0' }),
        chapter('v1c1', { chapter: '1', volume: '1' }),
        chapter('v2c1', { chapter: '1', volume: '2' }),
        chapter('c5a', { chapter: '5', title: 'Five' }, 'GroupA'),
        chapter('c5b', { chapter: '5', title: 'Five', translatedLanguage: 'zh-hk' }, 'GroupB'),
        chapter('c10.5', { chapter: '10.5' }),
        chapter('oneshot', {}),
        chapter('c5a', { chapter: '5', title: 'Five' }, 'GroupA'),
      ];
      serveFeed(pagedTiers({ 'zh,zh-hk': items }));
      const result = await chaptersOf('page-versions');
      expect(result.error).toBeUndefined();
      expect(result.data).toEqual([
        { id: 'c0', title: '第0话', chapterNo: 0 },
        { id: 'v1c1', title: '第1话', chapterNo: 1 },
        { id: 'v2c1', title: '第1话', chapterNo: 1 },
        { id: 'c5a', title: '第5话 Five [GroupA · zh]', chapterNo: 5 },
        { id: 'c5b', title: '第5话 Five [GroupB · zh-hk]', chapterNo: 5 },
        { id: 'c10.5', title: '第10.5话', chapterNo: 10.5 },
        { id: 'oneshot', title: '单页 / Oneshot', chapterNo: 0 },
      ]);
    });

    it('drops external-link and zero-page chapters but keeps readable and unknown-page ones', async () => {
      const items = [
        chapter('ext1', { chapter: '1', externalUrl: 'https://example.com/c1', pages: 0 }, 'Official'),
        chapter('c1', { chapter: '1', pages: 20 }, 'GroupA'),
        chapter('ext2', { chapter: '2', externalUrl: 'https://example.com/c2' }),
        chapter('empty3', { chapter: '3', pages: 0 }),
        chapter('c3', { chapter: '3' }),
        chapter('c3.5', { chapter: '3.5', pages: 12 }),
      ];
      serveFeed(pagedTiers({ 'zh,zh-hk': items }));
      const result = await chaptersOf('page-external');
      expect(result.error).toBeUndefined();
      expect(result.data).toEqual([
        { id: 'c1', title: '第1话', chapterNo: 1 },
        { id: 'c3', title: '第3话', chapterNo: 3 },
        { id: 'c3.5', title: '第3.5话', chapterNo: 3.5 },
      ]);
    });

    it('falls back to English when Chinese only has external-link chapters', async () => {
      const chinese = [
        chapter('zh-ext1', { chapter: '1', externalUrl: 'https://example.com/zh1', pages: 0 }),
        chapter('zh-empty2', { chapter: '2', pages: 0 }),
      ];
      const english = [
        chapter('en1', { chapter: '1', translatedLanguage: 'en', pages: 18 }),
        chapter('en2', { chapter: '2', translatedLanguage: 'en' }),
      ];
      const requested = serveFeed(pagedTiers({ 'zh,zh-hk': chinese, en: english }));
      const result = await chaptersOf('page-external-fallback');
      expect(result.error).toBeUndefined();
      expect(result.data!.map((c) => c.id)).toEqual(['en1', 'en2']);
      expect(requested.map((u) => tierOf(u))).toEqual(['zh,zh-hk', 'en']);
    });
  });

  it('gets reader images via MangaDex At-Home server', async () => {
    const mockAtHomeResponse = {
      baseUrl: 'https://uploads.mangadex.org',
      chapter: {
        hash: 'chapterhash123',
        data: ['page1.png', 'page2.png']
      }
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify(mockAtHomeResponse),
    } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<Array<{ url: string; headers: Record<string, string> }>>('getImages', ['chap-1']);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { url: 'https://uploads.mangadex.org/data/chapterhash123/page1.png', headers: { 'User-Agent': 'Titanhub/1.0' } },
      { url: 'https://uploads.mangadex.org/data/chapterhash123/page2.png', headers: { 'User-Agent': 'Titanhub/1.0' } },
    ]);
  });
});
