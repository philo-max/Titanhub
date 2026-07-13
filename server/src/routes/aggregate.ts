import { Hono } from 'hono';
import { getPlugins, db } from '../db/db';
import { mediaViews } from '../db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { PluginManager } from '../plugins/manager';
import type { AggregatedMediaItem, MediaType } from '@titanhub/plugin-types';

const aggregate = new Hono();

const MEDIA_TYPES: MediaType[] = ['anime', 'manga', 'novel', 'movie'];
const PLUGIN_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, pluginId: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Plugin '${pluginId}' timed out after ${PLUGIN_TIMEOUT_MS}ms`)),
        PLUGIN_TIMEOUT_MS
      )
    ),
  ]);
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
    const eligible = all.filter((p) => p.isActive && p.types.includes(type));

    const perPlugin = await Promise.all(
      eligible.map(async (plugin) => {
        try {
          const result = await withTimeout(PluginManager.explore(plugin.id, type), plugin.id);
          if (!result.success || !Array.isArray(result.data)) return [];
          return result.data.map((item): AggregatedMediaItem => ({
            ...item,
            pluginId: plugin.id,
            pluginName: plugin.name,
            mediaType: type,
          }));
        } catch (err: any) {
          console.warn(`[aggregate/home] Plugin '${plugin.id}' skipped: ${err.message}`);
          return [];
        }
      })
    );

    // Interleave results so no single source dominates the top of the grid
    const allItems: AggregatedMediaItem[] = [];
    const max = Math.max(0, ...perPlugin.map((l) => l.length));
    for (let i = 0; i < max; i++) {
      for (const list of perPlugin) {
        if (list[i]) allItems.push(list[i]);
      }
    }

    const total = allItems.length;
    const start = (page - 1) * pageSize;
    const items = allItems.slice(start, start + pageSize);

    return c.json({
      items,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
      sources: eligible.map((p) => ({ id: p.id, name: p.name })),
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
    const eligible = all.filter((p) => p.isActive && (!type || p.types.includes(type)));

    const perPlugin = await Promise.all(
      eligible.map(async (plugin) => {
        try {
          const result = await withTimeout(PluginManager.search(plugin.id, q), plugin.id);
          if (!result.success || !Array.isArray(result.data)) return [];
          const mediaType = (
            type && plugin.types.includes(type) ? type : plugin.types[0]
          ) as MediaType;
          return result.data.map((item): AggregatedMediaItem => ({
            ...item,
            pluginId: plugin.id,
            pluginName: plugin.name,
            mediaType,
          }));
        } catch (err: any) {
          console.warn(`[aggregate/search] Plugin '${plugin.id}' skipped: ${err.message}`);
          return [];
        }
      })
    );

    // Interleave results so no single source dominates the top of the list
    const items: AggregatedMediaItem[] = [];
    const max = Math.max(0, ...perPlugin.map((l) => l.length));
    for (let i = 0; i < max; i++) {
      for (const list of perPlugin) {
        if (list[i]) items.push(list[i]);
      }
    }

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

    if (!MEDIA_TYPES.includes(mediaType) || !mediaId || !pluginId || !title) {
      return c.json(
        { error: 'Required fields: mediaType, mediaId, pluginId, title.' },
        400
      );
    }

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
  const limit = Math.min(Number(c.req.query('limit')) || 10, 50);

  try {
    const rows = await db
      .select()
      .from(mediaViews)
      .where(type ? eq(mediaViews.mediaType, type) : undefined)
      .orderBy(desc(mediaViews.views))
      .limit(limit);

    return c.json({ items: rows });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default aggregate;
