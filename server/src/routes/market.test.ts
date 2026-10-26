import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import market from './market';
import { getPlugin, savePlugin } from '../db/db';

vi.mock('../db/db', () => ({ getPlugin: vi.fn(async () => null), savePlugin: vi.fn(async plugin => ({ ...plugin, createdAt: new Date().toISOString() })) }));

const app = new Hono();
app.route('/api/market', market);

const MOCK_KAZUMI_INDEX = [{ name: 'DemoAnime', version: '1.0.0' }];
const MOCK_LNREADER_INDEX = [
  {
    id: 'demo-novel',
    name: 'DemoNovel',
    version: '1.0.0',
    url: 'http://example.com/novel.js',
    lang: 'zh',
    site: 'DemoSite',
  },
];
const MOCK_VENERA_INDEX = [
  {
    key: 'demo-manga',
    name: 'DemoManga',
    version: '1.0.0',
    fileName: 'demo.js',
    description: 'Demo manga source',
  },
];

describe('Market route (GET /api/market/sources)', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('KazumiRules')) {
        return new Response(JSON.stringify(MOCK_KAZUMI_INDEX), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('lnreader-plugins')) {
        return new Response(JSON.stringify(MOCK_LNREADER_INDEX), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (urlStr.includes('venera-configs')) {
        return new Response(JSON.stringify(MOCK_VENERA_INDEX), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a sources array (possibly empty if all upstreams fail)', async () => {
    const res = await app.request('/api/market/sources');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sources: unknown[] };
    expect(json).toHaveProperty('sources');
    expect(Array.isArray(json.sources)).toBe(true);
    expect(json.sources.length).toBeGreaterThan(0);
  });

  it('returns cached results on second call', async () => {
    // First call populates cache
    const res1 = await app.request('/api/market/sources');
    const json1 = (await res1.json()) as { sources: unknown[] };

    // Second call should return cached data (same length)
    const res2 = await app.request('/api/market/sources');
    const json2 = (await res2.json()) as { sources: unknown[] };

    expect(json2.sources).toHaveLength(json1.sources.length);
  });

  it('points Kazumi downloads at current root files instead of a nonexistent rules directory', async () => {
    const response = await app.request('/api/market/sources?refresh=1');
    const body = await response.json() as any;
    expect(body.sources.find((source: any) => source.id === 'kazumi-demoanime').downloadUrl)
      .toBe('https://raw.githubusercontent.com/Predidit/KazumiRules/main/DemoAnime.json');
  });

  it('refreshes remote catalogs explicitly and reports individual provider status', async () => {
    vi.mocked(fetch).mockClear();
    const response = await app.request('/api/market/sources?refresh=1');
    const body = await response.json() as any;
    expect(fetch).toHaveBeenCalled();
    expect(body.providers).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'kazumi', status: 'live' })]));
  });
});

describe('Market route (POST /api/market/install)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('rejects invalid source types and download protocols without a network request', async () => {
    const { signUserToken } = await import('../auth/jwt');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const downloadUrl of ['http://example.org/source.js', 'file:///C:/file', 'invalid']) {
      const response = await app.request('/api/market/install', {
        method: 'POST', headers: { Authorization: `Bearer ${await signUserToken('test-user')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'test', name: 'Test', sourceType: 'venera', downloadUrl }),
      });
      expect(response.status).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cuts off an oversized source download before adapting or saving it', async () => {
    const { signUserToken } = await import('../auth/jwt');
    vi.mocked(savePlugin).mockClear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    const response = await app.request('/api/market/install', {
      method: 'POST', headers: { Authorization: `Bearer ${await signUserToken('test-user')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'test', name: 'Test', sourceType: 'venera', downloadUrl: 'https://example.org/source.js' }),
    });
    expect((await response.json() as any).error).toContain('大小限制');
    expect(savePlugin).not.toHaveBeenCalled();
  });

  it('rejects unsupported Dart before downloading or saving a source', async () => {
    const { signUserToken } = await import('../auth/jwt');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await app.request('/api/market/install', {
      method: 'POST', headers: { Authorization: `Bearer ${await signUserToken('test-user')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'mangayomi-manga-1', name: 'Dart', sourceType: 'mangayomi', type: 'manga', downloadUrl: 'https://example.org/source.dart', metadata: { sourceCodeLanguage: 0 } }),
    });
    expect(response.status).toBe(400);
    expect((await response.json() as any).error).toContain('Dart');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('adapts and saves JavaScript Mangayomi with original source metadata', async () => {
    const { signUserToken } = await import('../auth/jwt');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('class DefaultExtension extends MProvider { async search() { return { list: [], hasNextPage: false }; } }'));
    const response = await app.request('/api/market/install', {
      method: 'POST', headers: { Authorization: `Bearer ${await signUserToken('test-user')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'mangayomi-manga-7', name: 'JS', sourceType: 'mangayomi', type: 'manga', downloadUrl: 'https://example.org/source.js', metadata: { id: 7, sourceCodeLanguage: 1, baseUrl: 'https://example.org', lang: 'zh' } }),
    });
    expect(response.status).toBe(200);
    expect(savePlugin).toHaveBeenCalledWith(expect.objectContaining({ id: 'mangayomi-manga-7', types: ['manga'], code: expect.stringContaining('"sourceId":7') }));
  });

  it('keeps the users disabled state when reinstalling or updating a source', async () => {
    const { signUserToken } = await import('../auth/jwt');
    vi.mocked(getPlugin).mockResolvedValueOnce({ id: 'mangayomi-manga-7', isActive: false } as any);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('class DefaultExtension extends MProvider {}'));
    const response = await app.request('/api/market/install', {
      method: 'POST', headers: { Authorization: `Bearer ${await signUserToken('test-user')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'mangayomi-manga-7', name: 'JS', sourceType: 'mangayomi', type: 'manga', downloadUrl: 'https://example.org/source.js', metadata: { id: 7, sourceCodeLanguage: 1, baseUrl: 'https://example.org' } }),
    });
    expect(response.status).toBe(200);
    expect(savePlugin).toHaveBeenLastCalledWith(expect.objectContaining({ isActive: false, isBuiltin: false }));
  });

  it('returns 401 without authentication', async () => {
    const res = await app.request('/api/market/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'test', name: 'test', sourceType: 'kazumi', downloadUrl: 'http://example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    // We need a valid token to get past auth
    const { signUserToken } = await import('../auth/jwt');
    const token = await signUserToken('test-user');

    const res = await app.request('/api/market/install', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'test' }), // missing name, sourceType, downloadUrl
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('Missing required');
  });
});
