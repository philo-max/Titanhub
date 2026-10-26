import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { SqliteStorage, runMigrations, getSqliteStorage } from '../db/sqlite';
import { getPlugins, isDesktopDb, db } from '../db/db';
import { PluginManager } from '../plugins/manager';
import aggregate from './aggregate';

vi.mock('../db/db', () => ({
  getPlugins: vi.fn(), isDesktopDb: vi.fn(() => true),
  db: { select: vi.fn(() => { throw new Error('PostgreSQL must not be used in desktop mode'); }), insert: vi.fn(() => { throw new Error('PostgreSQL must not be used in desktop mode'); }) },
}));
vi.mock('../plugins/manager', () => ({ PluginManager: { explore: vi.fn(), search: vi.fn() } }));
vi.mock('../db/sqlite', async (original) => ({ ...await original<typeof import('../db/sqlite')>(), getSqliteStorage: vi.fn() }));

const app = new Hono().route('/api/aggregate', aggregate);
const source = (id: string) => ({ id, name: id, version: '1', types: ['anime'] as 'anime'[], isActive: true, code: 'providesVideo: false' });
const media = { id: 'm', title: 'Actual title', cover: 'https://example.test/cover.jpg' };
let directory: string;
let storage: SqliteStorage;

beforeAll(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'titanhub-aggregate-')); });
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(isDesktopDb).mockReturnValue(true);
  vi.mocked(getPlugins).mockResolvedValue([]);
  storage = await SqliteStorage.open({ dbPath: path.join(directory, `${crypto.randomUUID()}.db`) });
  runMigrations(storage);
  vi.mocked(getSqliteStorage).mockResolvedValue(storage);
});
afterEach(() => { vi.useRealTimers(); storage.close(); });
afterAll(() => { fs.rmSync(directory, { recursive: true, force: true }); });

describe('aggregate source results', () => {
  it('excludes bundled demo sources from home, search and ranking recommendations', async () => {
    vi.mocked(getPlugins).mockResolvedValue([
      ...['ssrfun', 'cyfz', 'tver', 'dmzj-mock', 'movie-mock'].map(id => ({ ...source(id), isBuiltin: true })),
      source('working'),
    ]);
    vi.mocked(PluginManager.explore).mockResolvedValue({ success: true, data: [media] });
    vi.mocked(PluginManager.search).mockResolvedValue({ success: true, data: [media] });
    const home = await (await app.request('/api/aggregate/home?type=anime')).json() as any;
    expect(home.sources.map((item: any) => item.id)).toEqual(['working']);
    const search = await (await app.request('/api/aggregate/search?q=actual&type=anime')).json() as any;
    expect(search.items[0].sources.map((item: any) => item.pluginId)).toEqual(['working']);
    const ranking = await (await app.request('/api/aggregate/ranking?type=anime')).json() as any;
    expect(ranking.items.map((item: any) => item.pluginId)).toEqual(['working']);
  });

  it('keeps working content and reports failed and empty sources separately', async () => {
    vi.mocked(getPlugins).mockResolvedValue([source('working'), source('failed'), source('empty')]);
    vi.mocked(PluginManager.explore).mockImplementation(async (id) => id === 'failed'
      ? { success: false, error: 'The argument filename received undefined' }
      : { success: true, data: id === 'working' ? [media] : [] });
    const response = await app.request('/api/aggregate/home?type=anime');
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.sources.map((entry: any) => entry.status)).toEqual(['success', 'error', 'empty']);
    expect(body.sources[1].message).toContain('引擎');
  });

  it('distinguishes all failed sources from having no enabled sources', async () => {
    vi.mocked(getPlugins).mockResolvedValue([source('failed')]);
    vi.mocked(PluginManager.explore).mockResolvedValue({ success: false, error: 'runtime initialization failed' });
    const failed = await (await app.request('/api/aggregate/home?type=anime')).json() as any;
    expect(failed.emptyReason).toBe('sources_failed');
    expect(failed.error).toBeTruthy();
    vi.mocked(getPlugins).mockResolvedValue([]);
    const absent = await (await app.request('/api/aggregate/home?type=anime')).json() as any;
    expect(absent.emptyReason).toBe('no_sources');
  });

  it('isolates malformed provider results instead of failing the whole aggregation', async () => {
    vi.mocked(getPlugins).mockResolvedValue([source('working'), source('malformed')]);
    vi.mocked(PluginManager.explore).mockImplementation(async (id) => ({ success: true, data: id === 'working' ? [media] : [null] as any }));
    const response = await app.request('/api/aggregate/home?type=anime');
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.sources[1].status).toBe('error');
  });

  it('does not query inactive or different-category providers and distinguishes valid empty results', async () => {
    vi.mocked(getPlugins).mockResolvedValue([source('empty'), { ...source('inactive'), isActive: false }, { ...source('manga'), types: ['manga'] }]);
    vi.mocked(PluginManager.explore).mockResolvedValue({ success: true, data: [] });
    const body = await (await app.request('/api/aggregate/home?type=anime')).json() as any;
    expect(body.emptyReason).toBe('empty');
    expect(body.sources).toMatchObject([{ id: 'empty', status: 'empty' }]);
    expect(PluginManager.explore).toHaveBeenCalledTimes(1);
  });

  it('reports timeouts and clears completed timeout handles', async () => {
    vi.useFakeTimers();
    vi.mocked(getPlugins).mockResolvedValue([source('slow')]);
    vi.mocked(PluginManager.explore).mockImplementation(() => new Promise(() => {}));
    const pending = app.request('/api/aggregate/home?type=anime');
    await vi.advanceTimersByTimeAsync(8001);
    const body = await (await pending).json() as any;
    expect(body.sources[0].status).toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('desktop ranking storage', () => {
  it('persists view counts in SQLite and isolates the full media identity', async () => {
    const view = async (pluginId: string, mediaType = 'anime') => app.request('/api/aggregate/view', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId, mediaType, mediaId: 'same', title: pluginId }),
    });
    expect((await view('a')).status).toBe(200);
    expect((await view('a')).status).toBe(200);
    expect((await view('b')).status).toBe(200);
    expect((await view('a', 'manga')).status).toBe(200);
    const response = await app.request('/api/aggregate/ranking?type=anime');
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.items.map((item: any) => [item.pluginId, item.views])).toEqual([['a', 2], ['b', 1]]);
    expect(storage.query('SELECT * FROM media_views')).toHaveLength(3);
    const dbPath = storage.getPath();
    storage.close();
    storage = await SqliteStorage.open({ dbPath });
    vi.mocked(getSqliteStorage).mockResolvedValue(storage);
    expect((await (await app.request('/api/aggregate/ranking?type=anime')).json() as any).items[0].views).toBe(2);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('uses real explore results when there are no local ranking records', async () => {
    vi.mocked(getPlugins).mockResolvedValue([source('working')]);
    vi.mocked(PluginManager.explore).mockResolvedValue({ success: true, data: [media] });
    const response = await app.request('/api/aggregate/ranking?type=anime');
    expect(response.status).toBe(200);
    expect((await response.json() as any).items).toMatchObject([{ mediaId: 'm', title: 'Actual title', views: 0 }]);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('retains PostgreSQL view and ranking behavior for the cloud deployment', async () => {
    vi.mocked(isDesktopDb).mockReturnValue(false);
    const rows = [{ mediaId: 'cloud-media', pluginId: 'cloud-source', mediaType: 'anime', title: 'Cloud', views: 4 }];
    const finishInsert = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValueOnce({ values: () => ({ onConflictDoUpdate: finishInsert }) } as any);
    vi.mocked(db.select).mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }) } as any);
    const saved = await app.request('/api/aggregate/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaType: 'anime', mediaId: 'cloud-media', pluginId: 'cloud-source', title: 'Cloud' }) });
    expect(saved.status).toBe(200);
    expect(finishInsert).toHaveBeenCalledOnce();
    expect((await (await app.request('/api/aggregate/ranking?type=anime')).json() as any).items).toEqual(rows);
    expect(getSqliteStorage).not.toHaveBeenCalled();
  });
});
