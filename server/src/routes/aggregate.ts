import { Hono } from 'hono';
import { getPlugins } from '../db/db';
import { PluginManager } from '../plugins/manager';
import type { AggregatedMediaItem, MediaType } from '@titanhub/plugin-types';

const aggregate = new Hono();

const MEDIA_TYPES: MediaType[] = ['anime', 'manga', 'novel', 'movie'];

// GET: Aggregated home feed for one media type, queried across all active plugins
aggregate.get('/home', async (c) => {
  const type = c.req.query('type') as MediaType;
  if (!MEDIA_TYPES.includes(type)) {
    return c.json(
      { error: `Query parameter "type" must be one of: ${MEDIA_TYPES.join(', ')}.` },
      400
    );
  }

  try {
    const all = await getPlugins();
    const eligible = all.filter((p) => p.isActive && p.types.includes(type));

    const perPlugin = await Promise.all(
      eligible.map(async (plugin) => {
        const result = await PluginManager.explore(plugin.id, type);
        if (!result.success || !Array.isArray(result.data)) return [];
        return result.data.map((item): AggregatedMediaItem => ({
          ...item,
          pluginId: plugin.id,
          pluginName: plugin.name,
          mediaType: type,
        }));
      })
    );

    // Interleave results so no single source dominates the top of the grid
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

export default aggregate;
