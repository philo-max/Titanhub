import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { findWorkspaceRoot, ServerManager } from './server-manager';

// Mock electron app
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'F:/Titanhub',
    on: vi.fn(),
  },
}));

function httpGetStatus(url: string, token?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = http.get(url, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

describe('ServerManager End-to-End Lifecycle & Port Management', () => {
  it('correctly resolves repository root from nested directories', () => {
    const rootFromSrc = findWorkspaceRoot(__dirname);
    expect(fs.existsSync(path.join(rootFromSrc, 'pnpm-workspace.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(rootFromSrc, 'server'))).toBe(true);
    expect(fs.existsSync(path.join(rootFromSrc, 'apps', 'web'))).toBe(true);

    const mockDistMain = path.resolve(rootFromSrc, 'apps', 'desktop', 'dist', 'main');
    const rootFromDist = findWorkspaceRoot(mockDistMain);
    expect(rootFromDist).toBe(rootFromSrc);
    expect(fs.existsSync(path.join(rootFromDist, 'server', 'src', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(rootFromDist, 'apps', 'web', 'package.json'))).toBe(true);
  });

  it('does not tear down the backend on before-quit while a quit guard defers it for a renderer flush', async () => {
    const { app } = await import('electron');
    const onMock = app.on as unknown as ReturnType<typeof vi.fn>;
    onMock.mockClear();
    const manager = new ServerManager();
    const stopSpy = vi.spyOn(manager, 'stopServices').mockResolvedValue();
    const beforeQuit = onMock.mock.calls.find(([event]) => event === 'before-quit')?.[1] as () => void;
    expect(beforeQuit).toBeTypeOf('function');

    let deferred = true;
    manager.setQuitGuard(() => deferred);
    beforeQuit();
    expect(stopSpy).not.toHaveBeenCalled();

    deferred = false;
    beforeQuit();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('detects available ports dynamically without collision', async () => {
    const port1 = await ServerManager.findAvailablePort(3001, '127.0.0.1');
    expect(port1).toBeGreaterThanOrEqual(3001);

    const isFree = await ServerManager.isPortFree(port1, '127.0.0.1');
    expect(isFree).toBe(true);
  });

  it('starts background services, serves healthcheck & web, and frees ports on stop', async () => {
    const manager = new ServerManager();

    // 1. Launch services
    const { backendUrl, webUrl } = await manager.startServices();
    expect(backendUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(webUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const backendPort = parseInt(new URL(backendUrl).port, 10);
    const webPort = parseInt(new URL(webUrl).port, 10);

    // 2. Assert services are live and reachable
    const backendStatus = await httpGetStatus(`${backendUrl}/api/health`);
    expect(backendStatus).toBe(200);

    const webStatus = await httpGetStatus(webUrl);
    expect(webStatus).toBe(200);

    const session = manager.getLocalSession();
    expect(session).toEqual({ apiBase: backendUrl, token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(process.env.TITANHUB_LOCAL_TOKEN).toBeUndefined();
    expect(await httpGetStatus(`${backendUrl}/api/sync/favorites`)).toBe(401);
    expect(await httpGetStatus(`${backendUrl}/api/sync/favorites`, 'x'.repeat(43))).toBe(401);
    expect(await httpGetStatus(`${backendUrl}/api/sync/favorites`, session!.token)).toBe(200);

    // 3. Stop services
    await manager.stopServices();
    expect(manager.getLocalSession()).toBeNull();

    // Give the OS 1 second to release sockets
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. Assert ports are released and free
    const backendPortReleased = await ServerManager.isPortFree(backendPort, '127.0.0.1');
    const webPortReleased = await ServerManager.isPortFree(webPort, '127.0.0.1');

    expect(backendPortReleased).toBe(true);
    expect(webPortReleased).toBe(true);
  }, 45000);

  it('runs production standalone bundle and standalone next server, verifies seeded plugins & clean port release', async () => {
    // Test the production packaged topology (esbuild bundle + Next standalone server)
    const prodManager = new ServerManager({ forceProduction: true });

    const { backendUrl, webUrl } = await prodManager.startServices();
    expect(backendUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(webUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const backendPort = parseInt(new URL(backendUrl).port, 10);
    const webPort = parseInt(new URL(webUrl).port, 10);

    // 1. Check backend health
    const healthStatus = await httpGetStatus(`${backendUrl}/api/health`);
    expect(healthStatus).toBe(200);

    // 2. Check plugin seeding and API functionality on dynamic backend port
    const pluginsStatus = await httpGetStatus(`${backendUrl}/api/plugins`);
    expect(pluginsStatus).toBe(200);

    const session = prodManager.getLocalSession();
    expect(session?.apiBase).toBe(backendUrl);
    expect(await httpGetStatus(`${backendUrl}/api/sync/favorites`)).toBe(401);
    expect(await httpGetStatus(`${backendUrl}/api/sync/favorites`, session!.token)).toBe(200);

    // 3. Check standalone Next.js web server
    const webStatus = await httpGetStatus(webUrl);
    expect(webStatus).toBe(200);

    // 4. Teardown and verify clean port release
    await prodManager.stopServices();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(await ServerManager.isPortFree(backendPort, '127.0.0.1')).toBe(true);
    expect(await ServerManager.isPortFree(webPort, '127.0.0.1')).toBe(true);
  }, 45000);
});
