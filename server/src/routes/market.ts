import { Hono } from 'hono';
import { requireAuth } from '../auth/jwt';
import { adaptKazumi, adaptLNReader, adaptVenera } from '@titanhub/plugin-adapter';
import { savePlugin } from '../db/db';
import type { MediaType } from '@titanhub/plugin-types';

type Env = {
  Variables: {
    userId: string;
  };
};

const market = new Hono<Env>();

interface MarketPlugin {
  id: string;
  name: string;
  version: string;
  type: MediaType;
  sourceType: 'kazumi' | 'lnreader' | 'venera';
  downloadUrl: string;
  description?: string;
  lang?: string;
}

// 10 minutes memory cache for market source listings
let cache: { data: MarketPlugin[]; expiresAt: number } | null = null;
const CACHE_DURATION = 10 * 60 * 1000;

async function fetchWithTimeout(url: string, timeout = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Helper to fetch Kazumi Rules index
async function getKazumiMarket(): Promise<MarketPlugin[]> {
  try {
    const res = await fetchWithTimeout('https://raw.githubusercontent.com/Predidit/KazumiRules/master/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json() as any[];
    return list.map((item: any) => ({
      id: `kazumi-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: `${item.name} (Kazumi)`,
      version: item.version || '1.0.0',
      type: 'anime' as const, // Default type for Kazumi rules
      sourceType: 'kazumi' as const,
      downloadUrl: `https://raw.githubusercontent.com/Predidit/KazumiRules/master/rules/${item.name}.json`,
      description: `动漫采集源，支持 XPath 解析。`,
    }));
  } catch (err) {
    console.error('Failed to fetch Kazumi market sources:', err);
    return [];
  }
}

// Helper to fetch LNReader Plugins index
async function getLNReaderMarket(): Promise<MarketPlugin[]> {
  try {
    const res = await fetchWithTimeout('https://raw.githubusercontent.com/LNReader/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json() as any[];
    return list.map((item: any) => ({
      id: `lnreader-${item.id}`,
      name: `${item.name} (LNReader)`,
      version: item.version || '1.0.0',
      type: 'novel' as const,
      sourceType: 'lnreader' as const,
      downloadUrl: item.url,
      lang: item.lang,
      description: `小说阅读源。站点: ${item.site || '未知'}，语言: ${item.lang || '中文'}。`,
    }));
  } catch (err) {
    console.error('Failed to fetch LNReader market sources:', err);
    return [];
  }
}

// Helper to fetch Venera Configs index
async function getVeneraMarket(): Promise<MarketPlugin[]> {
  try {
    const res = await fetchWithTimeout('https://raw.githubusercontent.com/venera-app/venera-configs/master/index.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json() as any[];
    return list.map((item: any) => ({
      id: `venera-${item.key || item.fileName.replace('.js', '')}`,
      name: `${item.name} (Venera)`,
      version: item.version || '1.0.0',
      type: 'manga' as const,
      sourceType: 'venera' as const,
      downloadUrl: `https://raw.githubusercontent.com/venera-app/venera-configs/master/${item.fileName}`,
      description: item.description || `漫画阅读源。支持 Cheerio 解析器。`,
    }));
  } catch (err) {
    console.error('Failed to fetch Venera market sources:', err);
    return [];
  }
}

// GET: Fetch all plugins from online markets
market.get('/sources', async (c) => {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return c.json({ sources: cache.data });
  }

  // Fetch all in parallel, gracefully degrading on failure
  const [kazumi, lnreader, venera] = await Promise.all([
    getKazumiMarket(),
    getLNReaderMarket(),
    getVeneraMarket(),
  ]);

  const sources = [...kazumi, ...lnreader, ...venera];

  // If we got some data, cache it
  if (sources.length > 0) {
    cache = {
      data: sources,
      expiresAt: now + CACHE_DURATION,
    };
  }

  return c.json({ sources });
});

// POST: Install plugin from market (requires authentication)
market.post('/install', requireAuth, async (c) => {
  try {
    const body = await c.req.json();
    const { id, name, version, sourceType, downloadUrl } = body;

    if (!id || !name || !sourceType || !downloadUrl) {
      return c.json({ error: 'Missing required parameters: id, name, sourceType, downloadUrl.' }, 400);
    }

    // Download code from market URL
    const res = await fetchWithTimeout(downloadUrl);
    if (!res.ok) {
      return c.json({ error: `Failed to download plugin from ${downloadUrl}. Status: ${res.status}` }, 400);
    }
    const rawContent = await res.text();

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
    } else {
      return c.json({ error: `Unsupported sourceType '${sourceType}'` }, 400);
    }

    // Save and activate in the database
    const saved = await savePlugin({
      id: adaptedPlugin.id,
      name: adaptedPlugin.name,
      version: adaptedPlugin.version,
      types: adaptedPlugin.types,
      code: adaptedPlugin.code,
      isActive: true,
      isBuiltin: false,
    });

    const { code, ...pluginInfo } = saved;
    return c.json({ success: true, plugin: pluginInfo });
  } catch (err: any) {
    console.error('Failed to install plugin from market:', err);
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default market;
