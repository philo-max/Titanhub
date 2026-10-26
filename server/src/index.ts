import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

import { adaptKazumi, adaptLNReader, upgradeLegacyLNReaderCode } from '@titanhub/plugin-adapter';

import { getPlugins, getPlugin, savePlugin, deletePlugin, setPluginActive } from './db/db';
import { PluginManager } from './plugins/manager';
import { requireAuth } from './auth/jwt';
import {
  initLocalSession,
  isDesktopAuthMode,
  setLocalSessionAddress,
  createLocalChallengeResponse,
} from './auth/local-session';
import auth from './routes/auth';
import sync from './routes/sync';
import history from './routes/history';
import danmakuRoutes from './routes/danmaku';
import danmakuEnhanced from './routes/danmaku-enhanced';
import aggregate from './routes/aggregate';
import market from './routes/market';
import visual from './routes/visual';
import { PlaywrightSniffer } from './plugins/sniffer';
import { M3u8AdFilter } from './plugins/m3u8';
import { createWebDavMessageHandler } from './sync/ipc';

initLocalSession(process.env);

if (isDesktopAuthMode() && process.send) {
  const handleWebDavMessage = createWebDavMessageHandler(response => {
    if (process.connected) process.send?.(response as Record<string, unknown>);
  });
  process.on('message', message => { void handleWebDavMessage(message); });
}

const app = new Hono();

// Enable CORS restricted to allowed origin in desktop/production, or all in open dev
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*';
      if (allowedOrigin) {
        if (origin === allowedOrigin) return origin;
        return null;
      }
      return origin;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// Health check endpoint for desktop shell and orchestrators
app.get('/api/health', async (c) => {
  await pluginsReady;
  return c.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/local-session/challenge', (c) => {
  if (!isDesktopAuthMode()) {
    return c.json({ error: 'Not found' }, 404);
  }
  const response = createLocalChallengeResponse(c.req.query('nonce') || '');
  if (!response) {
    return c.json({ error: 'Invalid challenge.' }, 400);
  }
  return c.json(response);
});

// Sniffer engine capability and availability probe
app.get('/api/sniffer/check', async (c) => {
  const sniffer = await PlaywrightSniffer.checkEngine();
  return c.json({ status: 'ok', sniffer });
});

// Mount authentication, sync, danmaku & market routes
app.route('/api/auth', auth);
app.route('/api/sync', sync);
app.route('/api/history', history);
app.route('/api/danmaku', danmakuRoutes);
app.route('/api/danmaku', danmakuEnhanced);
app.route('/api/aggregate', aggregate);
app.route('/api/market', market);
app.route('/api/visual', visual);

// Seed Mock site HTML data for plugin scraping tests
app.get('/mock-site/dmzj/manga-101', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head><title>Manga Test Detail</title></head>
    <body>
      <div class="manga-info">
        <h1 class="media-title">大角虫模拟漫画</h1>
        <span class="author">大眼萌猫</span>
        <span class="status">连载中</span>
        <div class="genres">
          <span class="genre">热血</span>
          <span class="genre">冒险</span>
          <span class="genre">科幻</span>
        </div>
        <p class="description">这是一款用于测试 WebAssembly QuickJS 隔离沙箱 Cheerio HTML 解析内核的模拟漫画作品。</p>
      </div>
      <ul class="chapter-list">
        <li><a href="chapter-1" data-no="1">第一话：觉醒之力</a></li>
        <li><a href="chapter-2" data-no="2">第二话：神秘的试炼</a></li>
        <li><a href="chapter-3" data-no="3">第三话：宿命的相遇</a></li>
      </ul>
    </body>
    </html>
  `);
});

app.get('/mock-site/dmzj/manga-101/chapter/:chapterId', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head><title>Manga Chapter</title></head>
    <body>
      <div class="manga-pages">
        <img class="page-img" src="https://picsum.photos/800/1200?random=1" />
        <img class="page-img" src="https://picsum.photos/800/1200?random=2" />
        <img class="page-img" src="https://picsum.photos/800/1200?random=3" />
        <img class="page-img" src="https://picsum.photos/800/1200?random=4" />
        <img class="page-img" src="https://picsum.photos/800/1200?random=5" />
      </div>
    </body>
    </html>
  `);
});

app.get('/mock-site/dmzj/novel-101', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head><title>Novel Test Detail</title></head>
    <body>
      <div class="manga-info">
        <h1 class="media-title">群星闪耀之模拟小说</h1>
        <span class="author">大眼萌猫</span>
        <span class="status">已完结</span>
        <div class="genres">
          <span class="genre">奇幻</span>
          <span class="genre">系统</span>
        </div>
        <p class="description">这是一款用于测试 WebAssembly QuickJS 隔离沙箱 HTML 文本选择提取器的模拟轻小说。</p>
      </div>
      <ul class="chapter-list">
        <li><a href="chapter-1" data-no="1">第一章：群星闪耀之时</a></li>
        <li><a href="chapter-2" data-no="2">第二章：深渊的回响</a></li>
      </ul>
    </body>
    </html>
  `);
});

app.get('/mock-site/dmzj/novel-101/chapter/:chapterId', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head><title>Novel Chapter</title></head>
    <body>
      <h1 class="novel-title">第一章：群星闪耀之时</h1>
      <div class="novel-content">
        <p>夜幕降临，繁星点缀着漆黑的夜空。在这个古老而神秘的帝国边缘，少年抬起头，仰望着那片闪烁的光芒。</p>
        <p>“那就是属于我的星辰吗？”他轻声自语，胸前的吊坠散发出微弱的荧光，仿佛在回应着他的呼唤。</p>
        <p>这是一个关于觉醒、探索与成长的奇幻冒险故事。就在今晚，命运的轮盘开始缓缓转动...</p>
      </div>
    </body>
    </html>
  `);
});

// Upsert mock plugins on startup so local code changes always reach the database
async function seedMockPlugin() {
  const seeds = [
    {
      id: 'dmzj-mock',
      name: 'DMZJ Scraper Mock Plugin',
      types: ['manga', 'novel'] as const,
      file: 'mock-dmzj.js',
    },
    {
      id: 'movie-mock',
      name: 'Movie Mock Plugin',
      types: ['movie'] as const,
      file: 'mock-movie.js',
    },
    { id: 'bangumi', name: 'Bangumi 番组计划', types: ['anime'] as const, file: 'bangumi.js' },
    {
      id: 'mangadex',
      name: 'MangaDex 漫画',
      types: ['manga'] as const,
      file: 'mangadex.js',
    },
    {
      id: 'alist',
      name: 'Alist 私有网盘',
      types: ['anime', 'manga', 'novel', 'movie'] as const,
      file: 'alist.js',
    },
    {
      id: 'seedhub',
      name: 'SeedHub 影视动漫',
      types: ['movie', 'anime'] as const,
      file: 'seedhub.js',
    },
    { id: 'dilidili', name: '嘀哩嘀哩 (Dilidili)', types: ['anime'] as const, file: 'dilidili.js' },
    { id: 'dm5', name: '动漫岛 (DM5)', types: ['manga'] as const, file: 'dm5.js' },
    { id: 'ssrfun', name: 'SSRFun动漫', types: ['anime'] as const, file: 'ssrfun.js' },
    { id: 'cyfz', name: '次元方舟', types: ['anime'] as const, file: 'cyfz.js' },
    { id: 'tver', name: 'TVer (官方生肉)', types: ['anime'] as const, file: 'tver.js' },
  ];

  function getPluginsDir(): string {
    if (process.env.TITANHUB_PLUGINS_DIR && fsSync.existsSync(process.env.TITANHUB_PLUGINS_DIR)) {
      return process.env.TITANHUB_PLUGINS_DIR;
    }
    const relativeToDist = path.join(__dirname, 'plugins');
    if (fsSync.existsSync(relativeToDist)) {
      return relativeToDist;
    }
    const relativeToCwd = path.join(process.cwd(), 'src', 'plugins');
    if (fsSync.existsSync(relativeToCwd)) {
      return relativeToCwd;
    }
    return path.join(process.cwd(), 'plugins');
  }

  const pluginsDir = getPluginsDir();

  try {
    for (const seed of seeds) {
      const pluginPath = path.join(pluginsDir, seed.file);
      if (!fsSync.existsSync(pluginPath)) continue;
      const code = await fs.readFile(pluginPath, 'utf-8');
      await savePlugin({
        id: seed.id,
        name: seed.name,
        version: '1.0.0',
        types: [...seed.types],
        code,
        isActive: true,
        isBuiltin: true,
      });
      console.log(`Seeded database with ${seed.name}.`);
    }
  } catch (err) {
    console.error('Failed to seed mock plugin database:', err);
  }

  // Seed real anime sources ported from the Kazumi rule repository (references/Kazumi)
  const rulesDir = path.join(pluginsDir, 'rules');
  try {
    if (fsSync.existsSync(rulesDir)) {
      const ruleFiles = (await fs.readdir(rulesDir)).filter((f) => f.endsWith('.json'));
      for (const file of ruleFiles) {
        try {
          const rule = JSON.parse(await fs.readFile(path.join(rulesDir, file), 'utf-8'));
          const adapted = adaptKazumi(rule);
          const existing = await getPlugin(adapted.id);
          if (existing && !existing.isBuiltin) continue;
          await savePlugin({
            ...adapted,
            isActive: true,
            isBuiltin: true,
          });
          console.log(`Seeded Kazumi rule plugin ${adapted.name} (${adapted.id}).`);
        } catch (err) {
          console.error(`Failed to seed Kazumi rule ${file}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('Failed to read Kazumi rules directory:', err);
  }

  try {
    for (const plugin of await getPlugins()) {
      const upgraded = upgradeLegacyLNReaderCode(plugin.code, { id: plugin.id, name: plugin.name, version: plugin.version });
      if (upgraded === null) continue;
      await savePlugin({ ...plugin, code: upgraded });
      console.log(`Upgraded legacy LNReader plugin ${plugin.name} (${plugin.id}).`);
    }
  } catch (err) {
    console.error('Failed to upgrade legacy LNReader plugins:', err);
  }
}
const pluginsReady = seedMockPlugin();

// Health check endpoint - trigger seeding reload version 2
app.get('/health', async (c) => {
  await pluginsReady;
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime: typeof Bun !== 'undefined' ? 'Bun' : 'Node.js',
  });
});

// GET: List all installed plugins
app.get('/api/plugins', async (c) => {
  const list = await getPlugins();
  // Don't leak source code in index list to keep payload smaller
  return c.json({
    plugins: list.map(({ code, ...rest }) => ({
      ...rest,
      // Detect info-only plugins that export providesVideo: false
      providesVideo: !/providesVideo\s*:\s*false/.test(code),
    })),
  });
});

// POST: Install/update a plugin (requires login)
app.post('/api/plugins', requireAuth, async (c) => {
  try {
    const body = await c.req.json();
    if (!body.id || !body.name || !body.code || !body.types) {
      return c.json({ error: 'Missing required parameters: id, name, types, code.' }, 400);
    }

    const saved = await savePlugin({
      id: body.id,
      name: body.name,
      version: body.version || '1.0.0',
      types: body.types,
      code: body.code,
      isActive: body.isActive !== undefined ? body.isActive : true,
    });

    return c.json({ success: true, plugin: saved });
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500);
  }
});

// POST: Install an LNReader plugin (auto-wraps with LNReader runtime shim)
app.post('/api/plugins/lnreader', requireAuth, async (c) => {
  try {
    const body = await c.req.json();
    if (!body.id || !body.name || !body.source) {
      return c.json({ error: 'Missing required parameters: id, name, source.' }, 400);
    }

    const adapted = adaptLNReader(body.source, {
      id: body.id,
      name: body.name,
      version: body.version,
    });

    const saved = await savePlugin({
      ...adapted,
      isActive: body.isActive !== undefined ? body.isActive : true,
    });

    const { code: _code, ...rest } = saved;
    return c.json({ success: true, plugin: rest });
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500);
  }
});

// PATCH: Enable/disable a plugin (requires login)
app.patch('/api/plugins/:id', requireAuth, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    if (typeof body.isActive !== 'boolean') {
      return c.json({ error: 'Body must include boolean field "isActive".' }, 400);
    }
    const updated = await setPluginActive(id, body.isActive);
    if (!updated) {
      return c.json({ error: `Plugin with id '${id}' not found.` }, 404);
    }
    const { code: _code, ...rest } = updated;
    return c.json({ success: true, plugin: rest });
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500);
  }
});

// DELETE: Uninstall a plugin (requires login)
app.delete('/api/plugins/:id', requireAuth, async (c) => {
  const id = c.req.param('id');
  const deleted = await deletePlugin(id);
  if (!deleted) {
    return c.json({ error: `Plugin with id '${id}' not found.` }, 404);
  }
  return c.json({ success: true, message: `Plugin '${id}' uninstalled successfully.` });
});

// GET: Execute search inside sandbox
app.get('/api/plugins/:id/search', async (c) => {
  const id = c.req.param('id');
  const query = c.req.query('q') || '';

  if (!query) {
    return c.json({ error: 'Search query parameter "q" is required.' }, 400);
  }

  const result = await PluginManager.search(id, query);
  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }
  return c.json({ results: result.data });
});

// GET: Execute getDetail inside sandbox
app.get('/api/plugins/:id/detail/:mediaId', async (c) => {
  const id = c.req.param('id');
  const mediaId = c.req.param('mediaId');

  const result = await PluginManager.getDetail(id, mediaId);
  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }
  return c.json({ detail: result.data });
});

// GET: Execute getChapters inside sandbox
app.get('/api/plugins/:id/chapters/:mediaId', async (c) => {
  const id = c.req.param('id');
  const mediaId = c.req.param('mediaId');

  const result = await PluginManager.getChapters(id, mediaId);
  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }
  return c.json({ chapters: result.data });
});

// GET: Execute getVideoUrl inside sandbox (Anime/Movie)
app.get('/api/plugins/:id/video/:chapterId', async (c) => {
  const id = c.req.param('id');
  const chapterId = c.req.param('chapterId');

  const result = await PluginManager.getVideoUrl(id, chapterId);
  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }

  // Rewrite all M3U8 video streams to automatically route through local ad-filtering proxy
  const host = c.req.header('host') || 'localhost:3001';
  const protocol = c.req.url.startsWith('https') ? 'https' : 'http';
  const apiBase = `${protocol}://${host}`;

  const cleanVideos = (result.data || []).map((v: any) => {
    if (v.url && (v.url.includes('.m3u8') || v.url.includes('m3u8'))) {
      if (!v.url.includes('/api/m3u8/filter')) {
        return {
          ...v,
          url: `${apiBase}/api/m3u8/filter?url=${encodeURIComponent(v.url)}`,
        };
      }
    }
    return v;
  });

  return c.json({ videos: cleanVideos });
});

// GET: Execute getImages inside sandbox (Manga)
app.get('/api/plugins/:id/images/:chapterId', async (c) => {
  const id = c.req.param('id');
  const chapterId = c.req.param('chapterId');

  const result = await PluginManager.getImages(id, chapterId);
  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }
  return c.json({ images: result.data });
});

// GET: Execute getContent inside sandbox (Novel)
app.get('/api/plugins/:id/content/:chapterId', async (c) => {
  const id = c.req.param('id');
  const chapterId = c.req.param('chapterId');

  const result = await PluginManager.getContent(id, chapterId);
  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }
  return c.json({ content: result.data });
});

// GET: Execute explore inside sandbox
app.get('/api/plugins/:id/explore/:type', async (c) => {
  const id = c.req.param('id');
  const type = c.req.param('type') as any;

  const result = await PluginManager.explore(id, type);
  if (!result.success) {
    return c.json({ error: result.error }, 500);
  }
  return c.json({ items: result.data });
});

// GET: M3U8 ad-filtered proxy — fetches an m3u8 URL, strips ad segments, returns clean playlist
app.get('/api/m3u8/filter', async (c) => {
  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'Query parameter "url" is required.' }, 400);
  }
  try {
    const filtered = await M3u8AdFilter.filterFromUrl(url);
    c.header('Content-Type', 'application/vnd.apple.mpegurl');
    return c.body(filtered);
  } catch (err: any) {
    const message = err.message || String(err);
    if (message.includes('SecurityError') || message.includes('Invalid URL')) {
      return c.json({ error: message }, 400);
    }
    if (message.includes('aborted') || message.includes('timeout')) {
      return c.json({ error: 'Upstream M3U8 request timed out.' }, 504);
    }
    return c.json({ error: message }, 502);
  }
});

// GET: Fetch mock Danmaku list for the video player
// Start server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const host = process.env.HOST || '127.0.0.1';

if (typeof Bun === 'undefined' && process.env.NODE_ENV !== 'test') {
  serve(
    {
      fetch: app.fetch,
      port,
      hostname: host,
    },
    (info) => setLocalSessionAddress(host, info.port)
  );
  console.log(`Server is running on Node.js at http://${host}:${port}...`);
} else {
  setLocalSessionAddress(host, port);
  console.log(`Server is running on Bun at http://${host}:${port}...`);
}

// Close the shared headless browser on shutdown so restarts (e.g. tsx watch)
// don't leak Chromium processes.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await PlaywrightSniffer.close();
    process.exit(0);
  });
}

export default {
  port,
  fetch: app.fetch,
};
