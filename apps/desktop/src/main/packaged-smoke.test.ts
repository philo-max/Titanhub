import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import crypto from 'crypto';
import { createRequire } from 'module';
import { spawn, spawnSync, ChildProcess, exec } from 'child_process';
import { ServerManager } from './server-manager';
import { generateLocalToken, verifyBackendChallenge } from './local-session';

function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

function httpOptions(url: string, origin: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        method: 'OPTIONS',
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
        },
      },
      (res) => {
        resolve({ status: res.statusCode || 0, headers: res.headers });
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`Timeout OPTIONS on ${url}`));
    });
    req.end();
  });
}

function killTree(proc: ChildProcess | null): Promise<void> {
  return new Promise((resolve) => {
    if (!proc || !proc.pid || proc.killed) {
      resolve();
      return;
    }
    const pid = proc.pid;
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${pid} /T /F`, () => resolve());
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {}
      resolve();
    }
  });
}

describe('Packaged App (build-out/win-unpacked) Isolated Smoke Test', () => {
  let backendProc: ChildProcess | null = null;
  let webProc: ChildProcess | null = null;
  let sqliteTempDir = '';
  let guiTempDir = '';
  let guiProcess: ChildProcess | null = null;

  afterAll(async () => {
    await killTree(backendProc);
    await killTree(webProc);
    await killTree(guiProcess);
    if (sqliteTempDir && path.dirname(sqliteTempDir) === os.tmpdir()) {
      fs.rmSync(sqliteTempDir, { recursive: true, force: true });
    }
    if (guiTempDir && path.dirname(guiTempDir) === os.tmpdir()) {
      fs.rmSync(guiTempDir, { recursive: true, force: true });
    }
  });

  it('exercises real packaged Titanhub.exe binary, seeded plugins, sniffer check & dynamic CORS isolation', async () => {
    const packagedDir = path.resolve(__dirname, '../../build-out/win-unpacked');
    const exePath = path.join(packagedDir, 'Titanhub.exe');
    const serverBundlePath = path.join(packagedDir, 'resources/server/dist/index.js');
    const pluginsPath = path.join(packagedDir, 'resources/server/dist/plugins');
    const webServerPath = path.join(packagedDir, 'resources/apps/web/standalone/apps/web/server.js');

    // 1. Verify existence of packaged deliverables
    expect(fs.existsSync(exePath), `Titanhub.exe must exist in ${packagedDir}`).toBe(true);
    expect(fs.existsSync(serverBundlePath), `server/dist/index.js must exist in ${serverBundlePath}`).toBe(true);
    expect(fs.existsSync(pluginsPath), `server/dist/plugins must exist in ${pluginsPath}`).toBe(true);
    expect(fs.existsSync(webServerPath), `web server.js must exist in ${webServerPath}`).toBe(true);

    // 2. Allocate dynamic ports to verify port collision avoidance
    const backendPort = await ServerManager.findAvailablePort(3910, '127.0.0.1');
    const webPort = await ServerManager.findAvailablePort(3920, '127.0.0.1');
    const backendUrl = `http://127.0.0.1:${backendPort}`;
    const webUrl = `http://127.0.0.1:${webPort}`;
    const jwtSecret = crypto.randomBytes(32).toString('hex');
    const localToken = generateLocalToken();

    sqliteTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'titanhub-smoke-db-'));
    const sqliteTestDb = path.join(sqliteTempDir, 'test-smoke.db');

    // 3. Launch packaged backend via Titanhub.exe running as Node with IPC enabled
    backendProc = spawn(exePath, [serverBundlePath], {
      cwd: path.dirname(serverBundlePath),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        TITANHUB_DESKTOP: '1',
        TITANHUB_SQLITE_PATH: sqliteTestDb,
        PORT: String(backendPort),
        HOST: '127.0.0.1',
        JWT_SECRET: jwtSecret,
        TITANHUB_LOCAL_TOKEN: localToken,
        ALLOWED_ORIGIN: webUrl,
        TITANHUB_PLUGINS_DIR: pluginsPath,
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    // Wire mock Electron IPC listener responding to sniffer availability checks
    backendProc.on('message', (msg: any) => {
      if (msg && msg.type === 'sniff_check') {
        backendProc?.send({
          type: 'sniff_check_response',
          id: msg.id,
          available: true,
          engine: 'electron-chromium',
          version: '128.0.0.0',
        });
      }
    });

    // 4. Poll until backend is online and healthy
    const backendReady = await ServerManager.waitForHealth(`${backendUrl}/api/health`, 20000);
    expect(backendReady, 'Packaged backend must return HTTP 200 on /api/health').toBe(true);
    expect(fs.existsSync(sqliteTestDb), 'Packaged backend must create SQLite database file on startup').toBe(true);
    expect(await verifyBackendChallenge(backendUrl, localToken)).toBe(true);
    expect(await verifyBackendChallenge(backendUrl, generateLocalToken())).toBe(false);
    expect((await httpGet(`${backendUrl}/api/sync/favorites`)).status).toBe(401);
    expect(
      (await httpGet(`${backendUrl}/api/sync/favorites`, { Authorization: `Bearer ${localToken}` })).status
    ).toBe(200);

    // 5. Verify built-in plugins are imported into memory and retrievable via dynamic port
    let pluginsData: any = null;
    for (let i = 0; i < 25; i++) {
      const pluginsRes = await httpGet(`${backendUrl}/api/plugins`);
      if (pluginsRes.status === 200) {
        pluginsData = JSON.parse(pluginsRes.body);
        if (pluginsData.plugins && pluginsData.plugins.length >= 18) {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(Array.isArray(pluginsData?.plugins)).toBe(true);
    expect(pluginsData.plugins.length).toBeGreaterThanOrEqual(18);

    // 6. Verify sniffer engine dependency check
    const snifferRes = await httpGet(`${backendUrl}/api/sniffer/check`);
    expect(snifferRes.status).toBe(200);
    const snifferData = JSON.parse(snifferRes.body);
    expect(snifferData.sniffer.available).toBe(true);
    expect(snifferData.sniffer.engine).toBe('electron-chromium');

    // 7. Verify dynamic CORS isolation (P1 requirement)
    // Legitimate Web Origin -> allowed
    const validCors = await httpOptions(`${backendUrl}/api/plugins`, webUrl);
    expect(validCors.headers['access-control-allow-origin']).toBe(webUrl);

    // Unauthorized Origin -> denied (must not return '*' or the attacker's origin)
    const attackerCors = await httpOptions(`${backendUrl}/api/plugins`, 'http://malicious-website.com');
    expect(attackerCors.headers['access-control-allow-origin']).toBeUndefined();

    // 8. Launch packaged Next.js web server via Titanhub.exe
    webProc = spawn(exePath, [webServerPath], {
      cwd: path.dirname(webServerPath),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(webPort),
        HOSTNAME: '127.0.0.1',
        TITANHUB_API_BASE: backendUrl,
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const webReady = await ServerManager.waitForHealth(webUrl, 25000);
    expect(webReady, 'Packaged Next.js web server must return HTTP 200').toBe(true);

    const homePage = await httpGet(webUrl);
    expect(homePage.status).toBe(200);
    expect(homePage.body.length).toBeGreaterThan(500);

    // 9. Stop processes and verify clean socket release
    await killTree(backendProc);
    await killTree(webProc);
    backendProc = null;
    webProc = null;

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await ServerManager.isPortFree(backendPort, '127.0.0.1')).toBe(true);
    expect(await ServerManager.isPortFree(webPort, '127.0.0.1')).toBe(true);
  }, 60000);

  it('launches real GUI Electron app (Titanhub.exe --smoke-test), asserts window lifecycle, IPC sniffer & clean port release', async () => {
    const packagedDir = path.resolve(__dirname, '../../build-out/win-unpacked');
    const exePath = path.join(packagedDir, 'Titanhub.exe');

    expect(fs.existsSync(exePath), `Titanhub.exe must exist in ${packagedDir}`).toBe(true);

    // Launch real Electron GUI executable WITHOUT ELECTRON_RUN_AS_NODE
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    delete cleanEnv.NODE_PATH;
    delete cleanEnv.NODE_OPTIONS;
    guiTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'titanhub-gui-smoke-'));
    cleanEnv.TITANHUB_SQLITE_PATH = path.join(guiTempDir, 'data.db');

    const guiProc = guiProcess = spawn(exePath, ['--smoke-test', `--user-data-dir=${path.join(guiTempDir, 'profile')}`], {
      cwd: packagedDir,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdoutData = '';
    let stderrData = '';
    let detectedBackendUrl = '';
    let detectedWebUrl = '';

    guiProc.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutData += text;
      const match = text.match(/\[Desktop GUI Ready\] backendUrl=(http:\/\/[^\s]+) webUrl=(http:\/\/[^\s]+)/);
      if (match) {
        detectedBackendUrl = match[1];
        detectedWebUrl = match[2];
      }
    });

    guiProc.stderr?.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    // Wait for the GUI app to initialize its services and log ready state
    const startTime = Date.now();
    while (!detectedBackendUrl && Date.now() - startTime < 35000) {
      await new Promise((r) => setTimeout(r, 300));
    }

    expect(
      detectedBackendUrl,
      `GUI process must initialize backendUrl. Stdout: ${stdoutData} Stderr: ${stderrData}`
    ).toBeTruthy();
    expect(detectedWebUrl).toBeTruthy();

    const parsedBackend = new URL(detectedBackendUrl);
    const parsedWeb = new URL(detectedWebUrl);
    const backendPort = parseInt(parsedBackend.port, 10);
    const webPort = parseInt(parsedWeb.port, 10);

    // Assert backend /api/health returns 200
    const healthRes = await httpGet(`${detectedBackendUrl}/api/health`);
    expect(healthRes.status).toBe(200);

    // Assert plugins seeded in memory
    let pluginsData: any = null;
    for (let i = 0; i < 25; i++) {
      const pluginsRes = await httpGet(`${detectedBackendUrl}/api/plugins`);
      if (pluginsRes.status === 200) {
        pluginsData = JSON.parse(pluginsRes.body);
        if (pluginsData.plugins && pluginsData.plugins.length >= 18) {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(pluginsData?.plugins?.length).toBeGreaterThanOrEqual(18);

    // Assert real child-process IPC to ElectronSniffer
    const snifferRes = await httpGet(`${detectedBackendUrl}/api/sniffer/check`);
    expect(snifferRes.status).toBe(200);
    const snifferData = JSON.parse(snifferRes.body);
    expect(snifferData.sniffer.available).toBe(true);
    expect(snifferData.sniffer.engine).toBe('electron-chromium');

    // Assert web frontend serves HTML
    const webRes = await httpGet(detectedWebUrl);
    expect(webRes.status).toBe(200);
    expect(webRes.body.length).toBeGreaterThan(500);

    // Wait for the app to finish auto-closing its window and exit
    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        void killTree(guiProc).then(() => resolve(-1));
      }, 25000);
      guiProc.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);

    // Verify ports released by the GUI app on exit
    await new Promise((r) => setTimeout(r, 1500));
    expect(await ServerManager.isPortFree(backendPort, '127.0.0.1')).toBe(true);
    expect(await ServerManager.isPortFree(webPort, '127.0.0.1')).toBe(true);
  }, 60000);
});

const repoRoot = path.resolve(__dirname, '../../../..');
const webStandaloneDir = path.join(repoRoot, 'apps/web/standalone');
const electronBinary: string = createRequire(__filename)('electron');

function isInside(parent: string, child: string) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function copyDereferenced(from: string, to: string) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from)) copyDereferenced(path.join(from, name), path.join(to, name));
  } else {
    fs.copyFileSync(from, to);
  }
}

function findLinks(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (fs.lstatSync(full).isSymbolicLink()) found.push(full);
    else if (entry.isDirectory()) found.push(...findLinks(full));
  }
  return found;
}

function ancestorNodeModules(dir: string) {
  const found: string[] = [];
  let current = dir;
  for (;;) {
    if (fs.existsSync(path.join(current, 'node_modules'))) found.push(path.join(current, 'node_modules'));
    const parent = path.dirname(current);
    if (parent === current) return found;
    current = parent;
  }
}

function createIsolatedTempDir(prefix: string) {
  const bases = [os.tmpdir(), path.parse(os.tmpdir()).root, path.parse(repoRoot).root];
  for (const base of bases) {
    if (isInside(repoRoot, base) || ancestorNodeModules(base).length > 0) continue;
    try {
      return { base, dir: fs.mkdtempSync(path.join(base, prefix)) };
    } catch {}
  }
  throw new Error(`No writable temp base without ancestor node_modules among: ${bases.join(', ')}`);
}

describe('Web standalone artifact copied outside the repository', () => {
  let installBase = '';
  let installRoot = '';
  let serverPath = '';
  let webProc: ChildProcess | null = null;

  beforeAll(() => {
    expect(fs.existsSync(path.join(webStandaloneDir, 'apps/web/server.js')), 'run pnpm --filter titanhub-web build first').toBe(true);
    expect(findLinks(webStandaloneDir)).toEqual([]);

    ({ base: installBase, dir: installRoot } = createIsolatedTempDir('Titanhub 安装 冒烟-'));
    const installedStandalone = path.join(installRoot, 'resources/apps/web/standalone');
    copyDereferenced(webStandaloneDir, installedStandalone);
    serverPath = path.join(installedStandalone, 'apps/web/server.js');

    expect(isInside(repoRoot, installRoot)).toBe(false);
    expect(ancestorNodeModules(path.dirname(installedStandalone))).toEqual([]);
  });

  afterAll(async () => {
    await killTree(webProc);
    if (installRoot && path.dirname(installRoot) === installBase && path.basename(installRoot).startsWith('Titanhub 安装 冒烟-')) {
      fs.rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['node', process.execPath],
    ['electron', electronBinary],
  ])('serves home, static assets, settings and dynamic routes under %s', async (_runtime, binary) => {
    const webPort = await ServerManager.findAvailablePort(3940, '127.0.0.1');
    const backendPort = await ServerManager.findAvailablePort(webPort + 1, '127.0.0.1');
    const webUrl = `http://127.0.0.1:${webPort}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(webPort),
      HOSTNAME: '127.0.0.1',
      TITANHUB_API_BASE: `http://127.0.0.1:${backendPort}`,
      NODE_ENV: 'production',
    };
    delete env.NODE_PATH;
    delete env.NODE_OPTIONS;

    const childGlobalPaths = spawnSync(
      binary,
      ['-e', "process.stdout.write(JSON.stringify(require('module').globalPaths.filter((p) => require('fs').existsSync(p))))"],
      { env, encoding: 'utf8' }
    );
    expect(JSON.parse(childGlobalPaths.stdout)).toEqual([]);

    let stderr = '';
    webProc = spawn(binary, [serverPath], { cwd: path.dirname(serverPath), env, stdio: ['ignore', 'pipe', 'pipe'] });
    webProc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const ready = await ServerManager.waitForHealth(webUrl, 25000);
    expect(ready, `web server failed to start: ${stderr}`).toBe(true);

    const home = await httpGet(webUrl);
    expect(home.status).toBe(200);
    const staticAsset = home.body.match(/\/_next\/static\/[^"']+\.js/)?.[0];
    expect(staticAsset, 'home page must reference a static chunk').toBeTruthy();
    expect((await httpGet(`${webUrl}${staticAsset}`)).status).toBe(200);
    expect((await httpGet(`${webUrl}/settings`)).status).toBe(200);
    expect((await httpGet(`${webUrl}/anime/smoke-plugin/smoke-media`)).status).toBe(200);
    expect(stderr).not.toMatch(/Cannot find module/);

    await killTree(webProc);
    webProc = null;
  }, 60000);
});

const serverDistDir = path.join(repoRoot, 'server/dist');
const MOCK_SITE_PORT = 3001;

function requestJson(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 20000
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      url,
      {
        method,
        headers: payload ? { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : headers,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: raw ? JSON.parse(raw) : null });
          } catch {
            reject(new Error(`Non-JSON response from ${method} ${url} (${res.statusCode}): ${raw.slice(0, 500)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout ${method} ${url}`));
    });
    req.end(payload);
  });
}

const engineFixturePluginCode = `
globalThis.plugin = {
  async explore(type) {
    const res = await fetch('http://127.0.0.1:${MOCK_SITE_PORT}/mock-site/engine/list.json?type=' + type);
    const list = JSON.parse(await res.json());
    return list.items.map(function (item) { return { id: item.id, title: item.title, cover: item.cover }; });
  },
  async search(query) {
    const html = await fetch('http://127.0.0.1:${MOCK_SITE_PORT}/mock-site/engine/search?q=' + encodeURIComponent(query)).then(function (r) { return r.text(); });
    const links = JSON.parse(htmlParser.select(html, '//ul[@id="results"]/li/a'));
    return links.map(function (link) { return { id: link.attrs['data-id'], title: link.text.trim() }; });
  },
  async getDetail(mediaId) {
    const html = await fetch('http://127.0.0.1:${MOCK_SITE_PORT}/mock-site/engine/detail/' + mediaId).then(function (r) { return r.text(); });
    return {
      id: mediaId,
      title: htmlParser.selectText(html, 'h1.title'),
      description: htmlParser.selectText(html, 'p.desc'),
      chapters: [],
    };
  },
  async getChapters() {
    await fetch('http://127.0.0.1:${MOCK_SITE_PORT}/private/secret');
    return [];
  },
};
`;

const spinFixturePluginCode = 'globalThis.plugin={explore:async function(){while(true){}}};';

function startEngineFixture(hits: string[]): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${MOCK_SITE_PORT}`);
    hits.push(url.pathname);
    if (url.pathname === '/mock-site/engine/list.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        items: [
          { id: 'alpha', title: `引擎 Alpha ${url.searchParams.get('type')}`, cover: 'https://example.com/a.jpg' },
          { id: 'beta', title: 'Engine Beta', cover: 'https://example.com/b.jpg' },
        ],
      }));
    } else if (url.pathname === '/mock-site/engine/search') {
      const q = url.searchParams.get('q') || '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<html><body><ul id="results"><li><a data-id="alpha" href="/a">${q} 结果一</a></li><li><a data-id="beta" href="/b">${q} 结果二</a></li></ul><div><a data-id="noise">noise</a></div></body></html>`);
    } else if (url.pathname === '/mock-site/engine/detail/alpha') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1 class="title">引擎 Alpha 详情</h1><p class="desc">来自本地 HTTP fixture</p></body></html>');
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(MOCK_SITE_PORT, '127.0.0.1', () => resolve(server));
  });
}

function countSeedSources(pluginsDir: string) {
  const scripts = fs.readdirSync(pluginsDir).filter((name) => name.endsWith('.js')).length;
  const rulesDir = path.join(pluginsDir, 'rules');
  const rules = fs.existsSync(rulesDir) ? fs.readdirSync(rulesDir).filter((name) => name.endsWith('.json')).length : 0;
  return scripts + rules;
}

describe('Server production bundle copied outside the repository executes real plugins', () => {
  let installBase = '';
  let installRoot = '';
  let installedDist = '';
  let fixture: http.Server | null = null;
  let backendProc: ChildProcess | null = null;
  const fixtureHits: string[] = [];

  beforeAll(async () => {
    expect(fs.existsSync(path.join(serverDistDir, 'index.js')), 'run pnpm --filter titanhub-server build first').toBe(true);
    ({ base: installBase, dir: installRoot } = createIsolatedTempDir('Titanhub 后端 引擎-'));
    installedDist = path.join(installRoot, 'resources/server/dist');
    copyDereferenced(serverDistDir, installedDist);
    expect(isInside(repoRoot, installRoot)).toBe(false);
    expect(ancestorNodeModules(installedDist)).toEqual([]);
    fixture = await startEngineFixture(fixtureHits);
  });

  afterAll(async () => {
    await killTree(backendProc);
    await new Promise<void>((resolve) => (fixture ? fixture.close(() => resolve()) : resolve()));
    if (installRoot && path.dirname(installRoot) === installBase && path.basename(installRoot).startsWith('Titanhub 后端 引擎-')) {
      fs.rmSync(installRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['node', process.execPath],
    ['electron', electronBinary],
  ])('installs and runs a fetch + XPath/HTML plugin through explore, search, detail and aggregate under %s', async (runtime, binary) => {
    const backendPort = await ServerManager.findAvailablePort(3960, '127.0.0.1');
    const backendUrl = `http://127.0.0.1:${backendPort}`;
    const localToken = generateLocalToken();
    const auth = { Authorization: `Bearer ${localToken}` };
    const pluginsDir = path.join(installedDist, 'plugins');
    const dataDir = path.join(installRoot, `数据 ${runtime}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      TITANHUB_DESKTOP: '1',
      TITANHUB_LOCAL_TOKEN: localToken,
      TITANHUB_SQLITE_PATH: path.join(dataDir, 'titanhub.db'),
      TITANHUB_PLUGINS_DIR: pluginsDir,
      HOST: '127.0.0.1',
      PORT: String(backendPort),
      NODE_ENV: 'production',
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    };
    delete env.NODE_PATH;
    delete env.NODE_OPTIONS;

    const childGlobalPaths = spawnSync(
      binary,
      ['-e', "process.stdout.write(JSON.stringify(require('module').globalPaths.filter((p) => require('fs').existsSync(p))))"],
      { env, encoding: 'utf8' }
    );
    expect(JSON.parse(childGlobalPaths.stdout)).toEqual([]);

    let logs = '';
    backendProc = spawn(binary, [path.join(installedDist, 'index.js')], { cwd: installedDist, env, stdio: ['ignore', 'pipe', 'pipe'] });
    backendProc.stdout?.on('data', (chunk) => {
      logs += chunk.toString();
    });
    backendProc.stderr?.on('data', (chunk) => {
      logs += chunk.toString();
    });

    expect(await ServerManager.waitForHealth(`${backendUrl}/api/health`, 20000), `backend failed to start: ${logs}`).toBe(true);

    const expectedSeeds = countSeedSources(pluginsDir);
    const listed = await requestJson('GET', `${backendUrl}/api/plugins`);
    const builtins: any[] = (listed.data?.plugins || []).filter((p: any) => p.isBuiltin);
    expect(builtins.length, `seeding incomplete: ${logs}`).toBe(expectedSeeds);

    for (const plugin of builtins.filter((p) => p.isActive)) {
      expect((await requestJson('PATCH', `${backendUrl}/api/plugins/${plugin.id}`, { isActive: false }, auth)).status).toBe(200);
    }

    const install = await requestJson('POST', `${backendUrl}/api/plugins`, { id: 'qa-engine-fixture', name: '引擎 Fixture', types: ['anime'], code: engineFixturePluginCode }, auth);
    expect(install.status, JSON.stringify(install.data)).toBe(200);

    const explore = await requestJson('GET', `${backendUrl}/api/plugins/qa-engine-fixture/explore/anime`);
    expect(explore.status, `${JSON.stringify(explore.data)}\n${logs}`).toBe(200);
    expect(explore.data.items).toEqual([
      { id: 'alpha', title: '引擎 Alpha anime', cover: 'https://example.com/a.jpg' },
      { id: 'beta', title: 'Engine Beta', cover: 'https://example.com/b.jpg' },
    ]);

    const search = await requestJson('GET', `${backendUrl}/api/plugins/qa-engine-fixture/search?q=${encodeURIComponent('守护神')}`);
    expect(search.status, JSON.stringify(search.data)).toBe(200);
    expect(search.data.results).toEqual([
      { id: 'alpha', title: '守护神 结果一' },
      { id: 'beta', title: '守护神 结果二' },
    ]);

    const detail = await requestJson('GET', `${backendUrl}/api/plugins/qa-engine-fixture/detail/alpha`);
    expect(detail.status, JSON.stringify(detail.data)).toBe(200);
    expect(detail.data.detail).toMatchObject({ id: 'alpha', title: '引擎 Alpha 详情', description: '来自本地 HTTP fixture' });

    const home = await requestJson('GET', `${backendUrl}/api/aggregate/home?type=anime`);
    expect(home.status).toBe(200);
    expect(home.data.items.map((item: any) => [item.title, item.sources.map((s: any) => `${s.pluginId}/${s.mediaId}`)])).toEqual(
      expect.arrayContaining([
        ['引擎 Alpha anime', ['qa-engine-fixture/alpha']],
        ['Engine Beta', ['qa-engine-fixture/beta']],
      ])
    );

    const aggregateSearch = await requestJson('GET', `${backendUrl}/api/aggregate/search?q=${encodeURIComponent('守护神')}&type=anime`);
    expect(aggregateSearch.status).toBe(200);
    expect(aggregateSearch.data.items.map((item: any) => item.title)).toEqual(expect.arrayContaining(['守护神 结果一', '守护神 结果二']));

    const blocked = await requestJson('GET', `${backendUrl}/api/plugins/qa-engine-fixture/chapters/alpha`);
    expect(blocked.status).toBe(500);
    expect(blocked.data.error).toMatch(/blocked by sandbox policy/);
    expect(fixtureHits).not.toContain('/private/secret');

    const spin = await requestJson('POST', `${backendUrl}/api/plugins`, { id: 'qa-engine-spin', name: 'Spin', types: ['movie'], code: spinFixturePluginCode }, auth);
    expect(spin.status).toBe(200);
    const spinStarted = Date.now();
    const spinResult = await requestJson('GET', `${backendUrl}/api/plugins/qa-engine-spin/explore/movie`);
    expect(spinResult.status).toBe(500);
    expect(spinResult.data.error).toMatch(/interrupt/i);
    expect(Date.now() - spinStarted).toBeLessThan(15000);

    expect(logs).not.toMatch(/must be a file URL|Cannot find module|ENOENT/);

    await killTree(backendProc);
    backendProc = null;
  }, 90000);
});
