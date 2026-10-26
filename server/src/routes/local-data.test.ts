import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { sign } from 'hono/jwt';
import { computeLocalChallengeProof } from '../auth/local-session';

const SERVER_DIR = path.resolve(__dirname, '..', '..');
const TSX_CLI = path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const STARTUP_TIMEOUT_MS = 30000;

interface Backend {
  proc: ChildProcess;
  baseUrl: string;
  port: number;
  output: string[];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
}

function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function startBackend(env: Record<string, string | undefined>): Promise<Backend> {
  const port = await freePort();
  const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development' };
  delete childEnv.VITEST;
  delete childEnv.TITANHUB_DESKTOP;
  delete childEnv.TITANHUB_USE_SQLITE;
  delete childEnv.TITANHUB_LOCAL_TOKEN;
  Object.assign(childEnv, { PORT: String(port), HOST: '127.0.0.1', JWT_SECRET, DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/none' }, env);
  for (const [key, value] of Object.entries(childEnv)) {
    if (value === undefined) delete childEnv[key];
  }
  const proc = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  proc.stdout?.on('data', (d) => output.push(d.toString()));
  proc.stderr?.on('data', (d) => output.push(d.toString()));
  return { proc, baseUrl: `http://127.0.0.1:${port}`, port, output };
}

async function waitForHealth(backend: Backend): Promise<boolean> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (backend.proc.exitCode !== null) return false;
    try {
      const res = await fetch(`${backend.baseUrl}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function waitForExit(proc: ChildProcess): Promise<number | null> {
  if (proc.exitCode !== null) return Promise.resolve(proc.exitCode);
  return new Promise((resolve) => proc.once('exit', (code) => resolve(code)));
}

async function stopBackend(backend: Backend | null): Promise<void> {
  if (!backend || backend.proc.exitCode !== null) return;
  const exited = waitForExit(backend.proc);
  backend.proc.kill();
  await exited;
}

async function api(
  backend: Backend,
  route: string,
  token: string | null,
  init: { method?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${backend.baseUrl}${route}`, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

describe('Desktop local data public API (spawned backend, temp SQLite)', () => {
  let tmpDir: string;
  let dbPath: string;
  let backend: Backend | null = null;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'titanhub-local-api-'));
    dbPath = path.join(tmpDir, 'data', 'titanhub.db');
  });

  afterEach(async () => {
    await stopBackend(backend);
    backend = null;
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  async function startDesktop(token: string | undefined): Promise<Backend> {
    const b = await startBackend({
      TITANHUB_DESKTOP: '1',
      TITANHUB_SQLITE_PATH: dbPath,
      TITANHUB_LOCAL_TOKEN: token,
    });
    backend = b;
    return b;
  }

  it('refuses to start in desktop mode without a launch capability', async () => {
    const b = await startDesktop(undefined);
    expect(await waitForHealth(b)).toBe(false);
    expect(await waitForExit(b.proc)).not.toBe(0);
  }, 40000);

  it('allows authenticated local source installation and PATCH preflight without a cloud account', async () => {
    const token = newToken();
    const b = await startDesktop(token);
    expect(await waitForHealth(b), b.output.join('')).toBe(true);
    const origin = 'http://127.0.0.1:3988';
    const preflight = await fetch(`${b.baseUrl}/api/plugins/qa-local-source`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type' },
    });
    expect(preflight.headers.get('access-control-allow-methods')?.split(',')).toContain('PATCH');
    const install = await api(b, '/api/plugins', token, {
      method: 'POST', body: { id: 'qa-local-source', name: 'Local source fixture', types: ['anime'], code: 'export default {};' },
    });
    expect(install.status).toBe(200);
    expect((await api(b, '/api/plugins/qa-local-source', null, { method: 'PATCH', body: { isActive: false } })).status).toBe(401);
    const toggled = await api(b, '/api/plugins/qa-local-source', token, { method: 'PATCH', body: { isActive: false } });
    expect(toggled.status).toBe(200);
    expect(toggled.json.plugin.isActive).toBe(false);
    expect((await api(b, '/api/plugins/qa-local-source', token, { method: 'DELETE' })).status).toBe(200);
  }, 40000);

  it('protects private routes, persists favourites/progress per full media key, and survives restart', async () => {
    const token = newToken();
    const b = await startDesktop(token);
    expect(await waitForHealth(b), b.output.join('')).toBe(true);

    const health = await api(b, '/api/health', null);
    expect(health.status).toBe(200);
    expect(Object.keys(health.json).sort()).toEqual(['status', 'timestamp']);

    expect((await api(b, '/api/local-session/challenge?nonce=short', null)).status).toBe(400);
    const nonce = crypto.randomBytes(32).toString('hex');
    const challenge = await api(b, `/api/local-session/challenge?nonce=${nonce}`, null);
    expect(challenge.status).toBe(200);
    expect(challenge.json).toEqual({
      host: '127.0.0.1',
      port: b.port,
      proof: computeLocalChallengeProof(token, nonce, '127.0.0.1', b.port),
    });

    expect((await api(b, '/api/sync/favorites', null)).status).toBe(401);
    expect((await api(b, '/api/sync/favorites', newToken())).status).toBe(401);
    const cloudJwt = await sign({ sub: 'local', exp: Math.floor(Date.now() / 1000) + 600 }, JWT_SECRET, 'HS256');
    expect((await api(b, '/api/sync/favorites', cloudJwt)).status).toBe(401);
    expect((await api(b, '/api/history', cloudJwt)).status).toBe(401);

    const add = await api(b, '/api/sync/favorites', token, {
      method: 'POST',
      body: {
        favorites: [
          { mediaType: 'anime', pluginId: 'plugin-a', mediaId: 'same-id' },
          { mediaType: 'anime', pluginId: 'plugin-b', mediaId: 'same-id' },
          { mediaType: 'manga', pluginId: 'plugin-a', mediaId: 'same-id' },
        ],
      },
    });
    expect(add.status).toBe(200);
    expect(add.json.success).toBe(true);
    expect(add.json.favorites).toHaveLength(3);

    const remove = await api(b, '/api/sync/favorites', token, {
      method: 'POST',
      body: { favorites: [{ mediaType: 'anime', pluginId: 'plugin-a', mediaId: 'same-id', isDeleted: true }] },
    });
    expect(remove.json.success).toBe(true);
    const remaining = remove.json.favorites.map((f: any) => `${f.mediaType}/${f.pluginId}/${f.mediaId}`).sort();
    expect(remaining).toEqual(['anime/plugin-b/same-id', 'manga/plugin-a/same-id']);

    const progress = await api(b, '/api/sync/tracking', token, {
      method: 'POST',
      body: {
        tracking: [
          { mediaType: 'anime', pluginId: 'plugin-a', mediaId: 'same-id', chapterId: 'ep-3', chapterNo: 3, progress: 0.5, position: 600, status: 'watching', updatedAt: '2026-10-23T10:00:00.000Z' },
          { mediaType: 'anime', pluginId: 'plugin-b', mediaId: 'same-id', chapterId: 'ep-1', chapterNo: 1, progress: 0.1, position: 42, status: 'watching', updatedAt: '2026-10-23T10:00:00.000Z' },
        ],
      },
    });
    expect(progress.json.success).toBe(true);
    expect(progress.json.tracking).toHaveLength(2);

    const rewatch = await api(b, '/api/sync/tracking', token, {
      method: 'POST',
      body: {
        tracking: [
          { mediaType: 'anime', pluginId: 'plugin-a', mediaId: 'same-id', chapterId: 'ep-3', chapterNo: 3, progress: 0.05, position: 60, status: 'watching', updatedAt: '2026-10-23T10:05:00.000Z' },
        ],
      },
    });
    const rewatched = rewatch.json.tracking.find((t: any) => t.pluginId === 'plugin-a');
    expect(rewatched.position).toBe(60);
    expect(rewatched.progress).toBe(0.05);

    const historyRes = await api(b, '/api/history', token, {
      method: 'POST',
      body: { mediaType: 'anime', pluginId: 'plugin-a', mediaId: 'same-id', chapterId: 'ep-3', chapterNo: 3, progress: 0.05 },
    });
    expect(historyRes.json.success).toBe(true);
    await api(b, '/api/history', token, {
      method: 'POST',
      body: { mediaType: 'anime', pluginId: 'plugin-b', mediaId: 'same-id', chapterId: 'ep-3', chapterNo: 3, progress: 0.2 },
    });
    expect((await api(b, '/api/history', token)).json.history).toHaveLength(2);

    await stopBackend(b);

    const nextToken = newToken();
    const reopened = await startDesktop(nextToken);
    expect(await waitForHealth(reopened), reopened.output.join('')).toBe(true);

    expect((await api(reopened, '/api/sync/favorites', token)).status).toBe(401);

    const favs = await api(reopened, '/api/sync/favorites', nextToken);
    expect(favs.status).toBe(200);
    expect(favs.json.favorites.map((f: any) => `${f.mediaType}/${f.pluginId}/${f.mediaId}`).sort()).toEqual([
      'anime/plugin-b/same-id',
      'manga/plugin-a/same-id',
    ]);

    const tracking = await api(reopened, '/api/sync/tracking', nextToken);
    const byPlugin = Object.fromEntries(tracking.json.tracking.map((t: any) => [t.pluginId, t]));
    expect(byPlugin['plugin-a']).toMatchObject({ chapterId: 'ep-3', position: 60, progress: 0.05 });
    expect(byPlugin['plugin-b']).toMatchObject({ chapterId: 'ep-1', position: 42, progress: 0.1 });

    expect((await api(reopened, '/api/history', nextToken)).json.history).toHaveLength(2);
  }, 90000);

  it('keeps JWT auth for non-desktop SQLite deployments and isolates the local principal', async () => {
    const localToken = newToken();
    const b = await startBackend({
      TITANHUB_USE_SQLITE: '1',
      TITANHUB_SQLITE_PATH: dbPath,
      TITANHUB_LOCAL_TOKEN: localToken,
    });
    backend = b;
    expect(await waitForHealth(b), b.output.join('')).toBe(true);

    expect((await api(b, '/api/sync/favorites', localToken)).status).toBe(401);
    const nonce = crypto.randomBytes(32).toString('hex');
    expect((await api(b, `/api/local-session/challenge?nonce=${nonce}`, null)).status).toBe(404);

    const jwt = await sign({ sub: 'cloud-user', exp: Math.floor(Date.now() / 1000) + 600 }, JWT_SECRET, 'HS256');
    const favs = await api(b, '/api/sync/favorites', jwt);
    expect(favs.status).toBe(200);
    expect(favs.json.favorites).toEqual([]);
  }, 60000);
});
