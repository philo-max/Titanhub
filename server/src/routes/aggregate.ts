import { Hono } from 'hono';
import { getPlugins, db } from '../db/db';
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
          const providesVideo = !/providesVideo\s*:\s*false/.test(plugin.code);
          return result.data.map((item): AggregatedMediaItem => ({
            ...item,
            pluginId: plugin.id,
            pluginName: plugin.name,
            mediaType: type,
            providesVideo,
          }));
        } catch (err: any) {
          console.warn(`[aggregate/home] Plugin '${plugin.id}' explore failed: ${err.message || err}`);
          return [];
        }
      })
    );

    const allItems = groupMediaItems(perPlugin);
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

    // If no view data yet, fall back to explore data from video-capable plugins
    // so the sidebar shows real content instead of fake mock data.
    if (rows.length === 0 && type) {
      const all = await getPlugins();
      const eligible = all.filter((p) => p.isActive && p.types.includes(type));
      const perPlugin = await Promise.all(
        eligible.map(async (plugin) => {
          try {
            const result = await withTimeout(PluginManager.explore(plugin.id, type), plugin.id);
            if (!result.success || !Array.isArray(result.data)) return [];
            return result.data.slice(0, 3).map((item) => ({
              mediaId: item.id,
              title: item.title,
              pluginId: plugin.id,
              mediaType: type,
              views: 0,
            }));
          } catch {
            return [];
          }
        })
      );
      const fallback = perPlugin.flat().slice(0, limit);
      return c.json({ items: fallback });
    }

    return c.json({ items: rows });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default aggregate;
