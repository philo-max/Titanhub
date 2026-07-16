import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import fs from 'fs/promises';
import path from 'path';

import { adaptKazumi, adaptLNReader } from '@titanhub/plugin-adapter';

import { getPlugins, savePlugin, deletePlugin, getPlugin, setPluginActive } from './db/db';
import { PluginManager } from './plugins/manager';
import { requireAuth } from './auth/jwt';
import auth from './routes/auth';
import sync from './routes/sync';
import danmakuRoutes from './routes/danmaku';
import danmakuEnhanced from './routes/danmaku-enhanced';
import aggregate from './routes/aggregate';
import { PlaywrightSniffer } from './plugins/sniffer';
import { M3u8AdFilter, M3u8Parser } from './plugins/m3u8';

const app = new Hono();

// Enable CORS for all domains
app.use('*', cors());

// Mount authentication, sync & danmaku routes
app.route('/api/auth', auth);
app.route('/api/sync', sync);
app.route('/api/danmaku', danmakuRoutes);
app.route('/api/danmaku', danmakuEnhanced);
app.route('/api/aggregate', aggregate);

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
  ];

  try {
    for (const seed of seeds) {
      const code = await fs.readFile(path.join(process.cwd(), 'src/plugins', seed.file), 'utf-8');
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
  const rulesDir = path.join(process.cwd(), 'src/plugins/rules');
  try {
    const ruleFiles = (await fs.readdir(rulesDir)).filter((f) => f.endsWith('.json'));
    for (const file of ruleFiles) {
      try {
        const rule = JSON.parse(await fs.readFile(path.join(rulesDir, file), 'utf-8'));
        const adapted = adaptKazumi(rule);
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
  } catch (err) {
    console.error('Failed to read Kazumi rules directory:', err);
  }
}
seedMockPlugin();

// Health check endpoint - trigger seeding reload version 2
app.get('/health', (c) => {
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

    const { code, ...rest } = saved;
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
    const { code, ...rest } = updated;
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
  return c.json({ videos: result.data });
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
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// GET: Fetch mock Danmaku list for the video player
// Start server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;

if (typeof Bun === 'undefined') {
  serve({
    fetch: app.fetch,
    port,
  });
  console.log(`Server is running on Node.js at http://localhost:${port}...`);
} else {
  console.log(`Server is running on Bun at http://localhost:${port}...`);
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

