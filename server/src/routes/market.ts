import { Hono } from 'hono';
import { requireAuth } from '../auth/jwt';
import { adaptKazumi, adaptLNReader, adaptVenera, adaptMangayomi } from '@titanhub/plugin-adapter';
import { getPlugin, savePlugin } from '../db/db';
import type { MediaType } from '@titanhub/plugin-types';
import { loadMarketCatalog, type MarketCatalog } from '../sources/catalog';

type Env = {
  Variables: {
    userId: string;
  };
};

const market = new Hono<Env>();

// 10 minutes memory cache for market source listings
let cache: { data: MarketCatalog; expiresAt: number } | null = null;
const CACHE_DURATION = 10 * 60 * 1000;

async function fetchSourceCode(url: string, timeout = 8000): Promise<{ status: number; code: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let releaseReader: (() => Promise<void>) | undefined;
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); return { status: response.status, code: '' }; }
    if (!response.body) throw new Error('来源源码响应为空。');
    const reader = response.body.getReader();
    releaseReader = async () => { await reader.cancel().catch(() => {}); reader.releaseLock(); };
    const chunks: Uint8Array[] = [];
    const maximumBytes = 2 * 1024 * 1024;
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error('来源源码超过大小限制。');
      chunks.push(value);
    }
    return { status: response.status, code: Buffer.concat(chunks).toString('utf8') };
  } finally {
    clearTimeout(timer);
    await releaseReader?.();
  }
}

// GET: Fetch all plugins from online markets
market.get('/sources', async (c) => {
  const now = Date.now();
  if (c.req.query('refresh') !== '1' && cache && cache.expiresAt > now) {
    return c.json(cache.data);
  }

  const catalog = await loadMarketCatalog();

  // If we got some data, cache it
  if (catalog.sources.length > 0) {
    cache = {
      data: catalog,
      expiresAt: now + CACHE_DURATION,
    };
  }

  return c.json(catalog);
});

// POST: Install plugin from market (requires authentication)
market.post('/install', requireAuth, async (c) => {
  try {
    const body = await c.req.json();
    const { id, name, version, sourceType, downloadUrl } = body;

    if (![id, name, sourceType, downloadUrl].every(value => typeof value === 'string' && value.trim())) {
      return c.json({ error: 'Missing required parameters: id, name, sourceType, downloadUrl.' }, 400);
    }

    let parsedUrl: URL;
    try { parsedUrl = new URL(downloadUrl); } catch { return c.json({ error: '来源下载地址无效。' }, 400); }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) return c.json({ error: '来源下载地址必须为 HTTPS。' }, 400);
    if (!['kazumi', 'lnreader', 'venera', 'mangayomi'].includes(sourceType)) return c.json({ error: `Unsupported sourceType '${sourceType}'` }, 400);

    if (sourceType === 'mangayomi' && (body.metadata?.sourceCodeLanguage !== 1 || !['manga', 'novel'].includes(body.type) || typeof body.metadata?.baseUrl !== 'string' || new URL(downloadUrl).pathname.endsWith('.dart'))) {
      return c.json({ error: '当前仅支持 Mangayomi JavaScript 漫画或小说来源；Dart 来源运行时尚未接入。' }, 400);
    }

    // Download code from market URL
    const downloaded = await fetchSourceCode(downloadUrl);
    if (downloaded.status < 200 || downloaded.status >= 300) {
      return c.json({ error: `Failed to download plugin from ${downloadUrl}. Status: ${downloaded.status}` }, 400);
    }
    const rawContent = downloaded.code;

    let adaptedPlugin: { id: string; name: string; version: string; types: MediaType[]; code: string };

    if (sourceType === 'kazumi') {
      const rule = JSON.parse(rawContent);
      adaptedPlugin = adaptKazumi(rule);
    } else if (sourceType === 'lnreader') {
      adaptedPlugin = adaptLNReader(rawContent, {
        id,
        name: name.replace(/\s*\(LNReader\)$/i, ''), // Clean name prefix
        version,
      });
    } else if (sourceType === 'venera') {
      adaptedPlugin = adaptVenera(rawContent, {
        id,
        name: name.replace(/\s*\(Venera\)$/i, ''), // Clean name prefix
        version,
      });
    } else if (sourceType === 'mangayomi') {
      adaptedPlugin = adaptMangayomi(rawContent, {
        ...body.metadata, sourceId: body.metadata.id, id, name, version, type: body.type, baseUrl: body.metadata.baseUrl,
      });
    } else {
      return c.json({ error: `Unsupported sourceType '${sourceType}'` }, 400);
    }

    // Save and activate in the database
    const existing = await getPlugin(adaptedPlugin.id);
    const saved = await savePlugin({
      id: adaptedPlugin.id,
      name: adaptedPlugin.name,
      version: adaptedPlugin.version,
      types: adaptedPlugin.types,
      code: adaptedPlugin.code,
      isActive: existing?.isActive ?? true,
      isBuiltin: false,
    });

    const { code: _code, ...pluginInfo } = saved;
    return c.json({ success: true, plugin: pluginInfo });
  } catch (err: any) {
    console.error('Failed to install plugin from market:', err);
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default market;
