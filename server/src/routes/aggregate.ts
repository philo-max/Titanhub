import { Hono } from 'hono';
import { getPlugins, db, isDesktopDb, type DBPlugin } from '../db/db';
import { getSqliteStorage } from '../db/sqlite';
import { sqliteGetMediaRanking, sqliteRecordMediaView } from '../db/sqlite/media-views';
import { mediaViews } from '../db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { PluginManager } from '../plugins/manager';
import type { AggregatedMediaItem, MediaType, HubMediaGroup, HubMediaSource } from '@titanhub/plugin-types';

const aggregate = new Hono();

// Helper to group items by title
function groupMediaItems(perPluginItems: AggregatedMediaItem[][]): HubMediaGroup[] {
  const map = new Map<string, HubMediaGroup>();
  
  for (const list of perPluginItems) {
    for (const item of list) {
      const normTitle = item.title.replace(/[\s\-:：·]/g, '').toLowerCase();
      
      const source: HubMediaSource = {
        pluginId: item.pluginId,
        pluginName: item.pluginName,
        mediaId: item.id,
        providesVideo: item.providesVideo || false,
        isMetadata: !(item.providesVideo || false)
      };

      if (!map.has(normTitle)) {
        map.set(normTitle, {
          id: normTitle,
          title: item.title,
          cover: item.cover,
          description: item.description,
          mediaType: item.mediaType,
          sources: [source]
        });
      } else {
        const group = map.get(normTitle)!;
        group.sources.push(source);
        if (source.isMetadata && !group.sources.some(s => s !== source && s.isMetadata)) {
          group.title = item.title;
          if (item.cover) group.cover = item.cover;
          if (item.description) group.description = item.description;
        } else if (!group.cover && item.cover) {
          group.cover = item.cover;
        }
      }
    }
  }
  return Array.from(map.values());
}

const MEDIA_TYPES: MediaType[] = ['anime', 'manga', 'novel', 'movie'];
const PLUGIN_TIMEOUT_MS = 8000;
const BUILTIN_DEMO_IDS = new Set(['dmzj-mock', 'movie-mock', 'ssrfun', 'cyfz', 'tver']);

function isLiveSource(plugin: DBPlugin): boolean {
  return plugin.isActive && !(plugin.isBuiltin && BUILTIN_DEMO_IDS.has(plugin.id));
}

async function withTimeout<T>(promise: Promise<T>, pluginId: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        timeout = setTimeout(
          () => reject(new Error(`Plugin '${pluginId}' timed out after ${PLUGIN_TIMEOUT_MS}ms`)),
          PLUGIN_TIMEOUT_MS
        )
      ),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/filename|wasm|QuickJS|runtime initialization/i.test(message)) return '来源引擎初始化失败，请升级客户端。';
  if (/SecurityError|sandbox policy|Public DNS|Fake-IP/i.test(message)) return '来源地址未通过网络校验，请检查代理或 DNS 设置，或更换来源。';
  if (/timed out|timeout/i.test(message)) return '来源请求超时，请稍后重试。';
  if (/fetch|network|ECONN|ENOTFOUND/i.test(message)) return '来源网络请求失败，请检查网络或更换来源。';
  return '来源返回错误或无法解析，请在来源管理中检查。';
}

async function exploreSources(plugins: DBPlugin[], type: MediaType) {
  return Promise.all(plugins.map(async (plugin) => {
    const source = { id: plugin.id, name: plugin.name };
    try {
      const result = await withTimeout(PluginManager.explore(plugin.id, type), plugin.id);
      if (!result.success) throw new Error(result.error || 'Source request failed');
      if (!Array.isArray(result.data) || !result.data.every(item => item && typeof item.id === 'string' && item.id.length > 0 && typeof item.title === 'string' && item.title.trim().length > 0)) {
        throw new Error('Invalid source media data');
      }
      const providesVideo = !/providesVideo\s*:\s*false/.test(plugin.code);
      const items: AggregatedMediaItem[] = result.data.map(item => ({ ...item, cover: typeof item.cover === 'string' ? item.cover : '', pluginId: plugin.id, pluginName: plugin.name, mediaType: type, providesVideo }));
      return { items, source: { ...source, status: items.length ? 'success' : 'empty', itemCount: items.length } };
    } catch (error) {
      const message = failureMessage(error);
      const timedOut = error instanceof Error && /timed out|timeout/i.test(error.message);
      console.warn(`[aggregate/home] ${plugin.id}: ${message}`);
      return { items: [] as AggregatedMediaItem[], source: { ...source, status: timedOut ? 'timeout' : 'error', itemCount: 0, message } };
    }
  }));
}

// GET: Aggregated home feed for one media type, queried across all active plugins
aggregate.get('/home', async (c) => {
  const type = c.req.query('type') as MediaType;
  if (!MEDIA_TYPES.includes(type)) {
    return c.json(
      { error: `Query parameter "type" must be one of: ${MEDIA_TYPES.join(', ')}.` },
      400
    );
  }

  const page = Math.max(1, Number(c.req.query('page')) || 1);
  const pageSize = Math.min(Math.max(1, Number(c.req.query('pageSize')) || 20), 100);

  try {
    const all = await getPlugins();
    const eligible = all.filter((p) => isLiveSource(p) && p.types.includes(type));

    const perPlugin = await exploreSources(eligible, type);
    const allItems = groupMediaItems(perPlugin.map(result => result.items));
    const total = allItems.length;
    const start = (page - 1) * pageSize;
    const items = allItems.slice(start, start + pageSize);

    return c.json({
      items,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
      sources: perPlugin.map(result => result.source),
      ...(total === 0 ? {
        emptyReason: !eligible.length ? 'no_sources' : perPlugin.every(result => ['error', 'timeout'].includes(result.source.status)) ? 'sources_failed' : 'empty',
        error: !eligible.length ? '当前分类没有已启用的来源，请先到来源管理启用来源。' : perPlugin.every(result => ['error', 'timeout'].includes(result.source.status)) ? '所有已启用来源均加载失败，请查看来源状态。' : '当前来源暂未返回内容，可重试或更换来源。',
      } : {}),
    });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// GET: Aggregated search across all active plugins, optionally filtered by type
aggregate.get('/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const type = c.req.query('type') as MediaType | undefined;
  if (!q) {
    return c.json({ error: 'Query parameter "q" is required.' }, 400);
  }
  if (type && !MEDIA_TYPES.includes(type)) {
    return c.json(
      { error: `Query parameter "type" must be one of: ${MEDIA_TYPES.join(', ')}.` },
      400
    );
  }

  try {
    const all = await getPlugins();
    const eligible = all.filter((p) => isLiveSource(p) && (!type || p.types.includes(type)));

    const perPlugin = await Promise.all(
      eligible.map(async (plugin) => {
        try {
          const result = await withTimeout(PluginManager.search(plugin.id, q), plugin.id);
          if (!result.success || !Array.isArray(result.data)) return [];
          const mediaType = (
            type && plugin.types.includes(type) ? type : plugin.types[0]
          ) as MediaType;
          const providesVideo = !/providesVideo\s*:\s*false/.test(plugin.code);
          return result.data.map((item): AggregatedMediaItem => ({
            ...item,
            pluginId: plugin.id,
            pluginName: plugin.name,
            mediaType,
            providesVideo,
          }));
        } catch (err: any) {
          console.warn(`[aggregate/search] Plugin '${plugin.id}' skipped: ${err.message}`);
          return [];
        }
      })
    );

    const items = groupMediaItems(perPlugin);

    return c.json({ items, sources: eligible.map((p) => ({ id: p.id, name: p.name })) });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// POST: Record a view on a media detail page, used to drive the trending ranking
aggregate.post('/view', async (c) => {
  try {
    const body = await c.req.json();
    const { mediaType, mediaId, pluginId, title, cover } = body;

    if (!MEDIA_TYPES.includes(mediaType) || typeof mediaId !== 'string' || !mediaId || typeof pluginId !== 'string' || !pluginId || typeof title !== 'string' || !title || (cover !== undefined && typeof cover !== 'string')) {
      return c.json(
        { error: 'Required fields: mediaType, mediaId, pluginId, title.' },
        400
      );
    }

    if (isDesktopDb()) {
      sqliteRecordMediaView(await getSqliteStorage(), { mediaType, mediaId, pluginId, title, cover });
    } else {
      await db
        .insert(mediaViews)
        .values({ mediaType, mediaId, pluginId, title, cover, views: 1 })
        .onConflictDoUpdate({
          target: [mediaViews.pluginId, mediaViews.mediaId, mediaViews.mediaType],
          set: {
            views: sql`${mediaViews.views} + 1`,
            title,
            cover,
            updatedAt: new Date(),
          },
        });
    }

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// GET: Top trending media by real view counts, optionally filtered by type
aggregate.get('/ranking', async (c) => {
  const type = c.req.query('type') as MediaType | undefined;
  if (type && !MEDIA_TYPES.includes(type)) {
    return c.json(
      { error: `Query parameter "type" must be one of: ${MEDIA_TYPES.join(', ')}.` },
      400
    );
  }
  const limit = Math.max(1, Math.min(Math.floor(Number(c.req.query('limit')) || 10), 50));

  try {
    const rows = isDesktopDb()
      ? sqliteGetMediaRanking(await getSqliteStorage(), type, limit)
      : await db
      .select()
      .from(mediaViews)
      .where(type ? eq(mediaViews.mediaType, type) : undefined)
      .orderBy(desc(mediaViews.views))
      .limit(limit);

    // If no view data yet, fall back to explore data from video-capable plugins
    // so the sidebar shows real content instead of fake mock data.
    if (rows.length === 0 && type) {
      const all = await getPlugins();
      const eligible = all.filter((p) => isLiveSource(p) && p.types.includes(type));
      const perPlugin = await exploreSources(eligible, type);
      const fallback = perPlugin.flatMap(result => result.items.slice(0, 3).map(item => ({
        mediaId: item.id, title: item.title, pluginId: item.pluginId, mediaType: type, views: 0,
      }))).slice(0, limit);
      return c.json({ items: fallback });
    }

    return c.json({ items: rows });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default aggregate;
