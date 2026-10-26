import { spawn, ChildProcess, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import http from 'http';
import crypto from 'crypto';
import { app } from 'electron';
import { ElectronSniffer } from './sniffer';
import { generateLocalToken, verifyBackendChallenge } from './local-session';
import { requestWebDav, WebDavConfig, WebDavOperation } from './webdav';

export interface LocalSession {
  apiBase: string;
  token: string;
}

export interface ServerConfig {
  backendPort: number;
  backendHost: string;
  webPort: number;
  webHost: string;
  isPackaged: boolean;
}

/**
 * Locate the monorepo workspace root by searching upwards for pnpm-workspace.yaml.
 */
export function findWorkspaceRoot(startDir = __dirname): string {
  let current = path.resolve(startDir);
  while (current && current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml')) ||
      (fs.existsSync(path.join(current, 'package.json')) &&
        fs.existsSync(path.join(current, 'server')) &&
        fs.existsSync(path.join(current, 'apps')))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  // Fallback: 4 levels up from dist/main (apps/desktop/dist/main -> workspace root)
  return path.resolve(startDir, '../../../../');
}

/**
 * Retrieve or create a persistent 64-char cryptographically strong random JWT secret in userData.
 */
export function getOrGenerateJwtSecret(userDataDir?: string): string {
  let dir = userDataDir;
  if (!dir) {
    try {
      dir = app ? app.getPath('userData') : undefined;
    } catch {}
  }
  if (!dir) {
    dir = path.join(process.cwd(), '.desktop-data');
  }

  const secretFile = path.join(dir, 'jwt_secret');
  try {
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf-8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {}

  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  } catch (e) {
    console.warn('[ServerManager] Could not persist JWT secret to disk, using in-memory secret');
  }
  return secret;
}

export class ServerManager {
  private backendProcess: ChildProcess | null = null;
  private webProcess: ChildProcess | null = null;
  private isShuttingDown = false;
  private localSession: LocalSession | null = null;
  private quitGuard: (() => boolean) | null = null;
  private config: ServerConfig = {
    backendPort: 3001,
    backendHost: '127.0.0.1',
    webPort: 3000,
    webHost: '127.0.0.1',
    isPackaged: false,
  };
  private forceProductionMode = false;

  constructor(options?: { forceProduction?: boolean }) {
    this.forceProductionMode = options?.forceProduction ?? false;
    this.config.isPackaged = this.forceProductionMode || (app ? app.isPackaged : false);
    this.setupTerminationHooks();
  }

  getLocalSession(): LocalSession | null {
    return this.localSession ? { ...this.localSession } : null;
  }

  requestWebDav(operation: WebDavOperation, config: WebDavConfig) {
    return requestWebDav(this.backendProcess, operation, config);
  }

  setQuitGuard(guard: (() => boolean) | null): void {
    this.quitGuard = guard;
  }

  /**
   * Check if a TCP port is open on the specified host.
   */
  static isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on('error', () => resolve(false));
      server.listen(port, host, () => {
        server.close(() => resolve(true));
      });
    });
  }

  /**
   * Find an available port starting from initialPort, skipping any excluded ports.
   */
  static async findAvailablePort(
    initialPort: number,
    host = '127.0.0.1',
    excludePorts: number[] = []
  ): Promise<number> {
    let port = initialPort;
    while (!(await this.isPortFree(port, host)) || excludePorts.includes(port)) {
      port++;
    }
    return port;
  }

  /**
   * Poll a healthcheck endpoint until it returns HTTP 200 or times out.
   */
  static async waitForHealth(url: string, timeoutMs = 25000, intervalMs = 250): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const ok = await new Promise<boolean>((resolve) => {
          const req = http.get(url, (res) => {
            resolve(res.statusCode === 200);
          });
          req.on('error', () => resolve(false));
          req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
          });
        });
        if (ok) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  }

  /**
   * Initialize and start both backend and frontend services.
   */
  async startServices(): Promise<{ backendUrl: string; webUrl: string }> {
    const isDev = !this.config.isPackaged;
    const repoRoot = findWorkspaceRoot(__dirname);
    const workspaceRoot = isDev
      ? repoRoot
      : (app && app.isPackaged ? path.dirname(app.getAppPath()) : repoRoot);

    const isWin = process.platform === 'win32';
    // Use node executable or electron running as node
    const nodeExecutable = process.execPath;

    // 1. Dynamically allocate free ports to avoid collision and hijacked ports
    const backendPort = await ServerManager.findAvailablePort(3001, '127.0.0.1');
    const webPort = await ServerManager.findAvailablePort(
      backendPort === 3000 ? 3002 : 3000,
      '127.0.0.1',
      [backendPort]
    );

    this.config.backendPort = backendPort;
    this.config.webPort = webPort;

    const backendUrl = `http://${this.config.backendHost}:${backendPort}`;
    const webUrl = `http://${this.config.webHost}:${webPort}`;

    console.log(`[ServerManager] Mode: ${isDev ? 'Development' : 'Production'}`);
    console.log(`[ServerManager] Allocated Ports -> Backend: ${backendPort}, Web: ${webPort}`);
    console.log(`[ServerManager] Workspace Root: ${workspaceRoot}`);

    // 2. Launch Hono backend service
    let serverCmd: string;
    let serverArgs: string[];
    let serverCwd: string;
    const jwtSecret = getOrGenerateJwtSecret();
    const localToken = generateLocalToken();
    const userDataDir = typeof app?.getPath === 'function' ? app.getPath('userData') : path.resolve(repoRoot, '.desktop-data');
    const sqlitePath = process.env.TITANHUB_SQLITE_PATH || path.join(userDataDir, 'data', 'titanhub.db');
    const serverEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(backendPort),
      HOST: this.config.backendHost,
      TITANHUB_DESKTOP: '1',
      TITANHUB_SQLITE_PATH: sqlitePath,
      TITANHUB_LOCAL_TOKEN: localToken,
      JWT_SECRET: jwtSecret,
      ALLOWED_ORIGIN: webUrl,
      NODE_ENV: isDev ? 'development' : 'production',
    };

    if (isDev) {
      serverCwd = path.resolve(workspaceRoot, 'server');
      if (!fs.existsSync(serverCwd)) {
        throw new Error(`[ServerManager] Backend source directory not found: ${serverCwd}`);
      }
      serverCmd = nodeExecutable;
      serverArgs = ['--import', 'tsx', 'src/index.ts'];
      serverEnv.ELECTRON_RUN_AS_NODE = '1';
    } else {
      // Production: standalone bundle execution without npx or tsx
      const possibleBundlePaths = [
        path.join(process.resourcesPath || '', 'server', 'dist', 'index.js'),
        path.join(workspaceRoot, 'server', 'dist', 'index.js'),
        path.join(repoRoot, 'server', 'dist', 'index.js'),
      ].filter(Boolean);
      const bundlePath = possibleBundlePaths.find((p) => fs.existsSync(p));
      if (!bundlePath) {
        throw new Error(
          `[ServerManager] Packaged backend bundle not found in candidates: ${possibleBundlePaths.join(
            ', '
          )}`
        );
      }
      serverCwd = path.dirname(bundlePath);
      serverCmd = nodeExecutable;
      serverArgs = [bundlePath];
      serverEnv.ELECTRON_RUN_AS_NODE = '1';
      serverEnv.TITANHUB_PLUGINS_DIR = path.join(serverCwd, 'plugins');
    }

    console.log(`[ServerManager] Spawning Hono backend from ${serverCwd}...`);
    this.backendProcess = spawn(serverCmd, serverArgs, {
      cwd: serverCwd,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      shell: false,
    });

    // Wire Electron Chromium sniffer bridge over child_process IPC
    const sniffControllers = new Map<string, AbortController>();
    this.backendProcess.once('exit', () => {
      for (const controller of sniffControllers.values()) controller.abort();
      sniffControllers.clear();
    });
    this.backendProcess.on('message', async (msg: any) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'sniff_cancel') {
        sniffControllers.get(msg.id)?.abort();
      } else if (msg.type === 'sniff') {
        const controller = new AbortController();
        sniffControllers.set(msg.id, controller);
        try {
          const result = await ElectronSniffer.sniff(msg.url, msg.headers, Number(msg.timeoutMs) || undefined, {
            proxyUrl: typeof msg.proxy === 'string' ? msg.proxy : undefined,
            signal: controller.signal,
          });
          this.backendProcess?.send({
            type: 'sniff_response',
            id: msg.id,
            success: true,
            url: result,
          });
        } catch (err: any) {
          this.backendProcess?.send({
            type: 'sniff_response',
            id: msg.id,
            success: false,
            error: err?.message || String(err),
          });
        } finally {
          sniffControllers.delete(msg.id);
        }
      } else if (msg.type === 'sniff_check') {
        const availability = ElectronSniffer.checkAvailability();
        this.backendProcess?.send({
          type: 'sniff_check_response',
          id: msg.id,
          ...availability,
        });
      }
    });

    this.backendProcess.stdout?.on('data', (data) => {
      console.log(`[Backend stdout] ${data.toString().trim()}`);
    });
    this.backendProcess.stderr?.on('data', (data) => {
      console.error(`[Backend stderr] ${data.toString().trim()}`);
    });
    this.backendProcess.on('exit', (code, signal) => {
      console.log(`[Backend process exited] code=${code} signal=${signal}`);
      this.backendProcess = null;
    });

    // Wait for backend healthcheck probe
    const backendHealthy = await ServerManager.waitForHealth(`${backendUrl}/api/health`, 20000);
    if (!backendHealthy) {
      await this.stopServices();
      throw new Error(`Failed to start backend server at ${backendUrl}/api/health`);
    }
    const backendVerified = await verifyBackendChallenge(backendUrl, localToken);
    if (!backendVerified) {
      await this.stopServices();
      throw new Error(`Backend at ${backendUrl} failed the local session challenge`);
    }
    console.log(`[ServerManager] Hono backend is online and healthy at ${backendUrl}!`);

    // 3. Launch Web frontend service
    let webCmd: string;
    let webArgs: string[];
    let webCwd: string;
    const webEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(webPort),
      HOSTNAME: this.config.webHost,
      NEXT_PUBLIC_API_URL: backendUrl,
      TITANHUB_API_BASE: backendUrl,
      NODE_ENV: isDev ? 'development' : 'production',
    };

    if (isDev) {
      webCwd = path.resolve(workspaceRoot, 'apps', 'web');
      if (!fs.existsSync(webCwd)) {
        await this.stopServices();
        throw new Error(`[ServerManager] Web directory not found: ${webCwd}`);
      }
      webCmd = isWin ? 'cmd.exe' : 'npx';
      webArgs = isWin
        ? ['/c', 'npx', 'next', 'dev', '-p', String(webPort), '-H', this.config.webHost]
        : ['next', 'dev', '-p', String(webPort), '-H', this.config.webHost];
    } else {
      // Production: standalone server.js execution without npx or next CLI
      const possibleStandalonePaths = [
        path.join(process.resourcesPath || '', 'apps', 'web', 'standalone', 'apps', 'web', 'server.js'),
        path.join(workspaceRoot, 'apps', 'web', 'standalone', 'apps', 'web', 'server.js'),
        path.join(repoRoot, 'apps', 'web', 'standalone', 'apps', 'web', 'server.js'),
        path.join(workspaceRoot, 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'server.js'),
        path.join(repoRoot, 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'server.js'),
      ].filter(Boolean);
      const standaloneServerPath = possibleStandalonePaths.find((p) => fs.existsSync(p));
      if (!standaloneServerPath) {
        await this.stopServices();
        throw new Error(
          `[ServerManager] Standalone Next.js server not found in candidates: ${possibleStandalonePaths.join(
            ', '
          )}`
        );
      }
      webCwd = path.dirname(standaloneServerPath);
      webCmd = nodeExecutable;
      webArgs = [standaloneServerPath];
      webEnv.ELECTRON_RUN_AS_NODE = '1';
    }

    console.log(`[ServerManager] Spawning Web frontend from ${webCwd}...`);
    this.webProcess = spawn(webCmd, webArgs, {
      cwd: webCwd,
      env: webEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    this.webProcess.stdout?.on('data', (data) => {
      console.log(`[Web stdout] ${data.toString().trim()}`);
    });
    this.webProcess.stderr?.on('data', (data) => {
      console.error(`[Web stderr] ${data.toString().trim()}`);
    });
    this.webProcess.on('exit', (code, signal) => {
      console.log(`[Web process exited] code=${code} signal=${signal}`);
      this.webProcess = null;
    });

    // Wait for Web frontend to be ready
    const webHealthy = await ServerManager.waitForHealth(webUrl, 30000);
    if (!webHealthy) {
      await this.stopServices();
      throw new Error(`Failed to start web frontend at ${webUrl}`);
    }
    console.log(`[ServerManager] Web frontend is online and healthy at ${webUrl}!`);

    this.localSession = { apiBase: backendUrl, token: localToken };
    return { backendUrl, webUrl };
  }

  /**
   * Recursively kill a child process and all its child subprocesses.
   */
  private killProcessTree(proc: ChildProcess | null): Promise<void> {
    return new Promise((resolve) => {
      if (!proc || !proc.pid || proc.killed) {
        resolve();
        return;
      }

      const pid = proc.pid;
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${pid} /T /F`, (_err) => {
          resolve();
        });
      } else {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            proc.kill('SIGKILL');
          } catch {}
        }
        resolve();
      }
    });
  }

  /**
   * Stop all managed processes.
   */
  async stopServices(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.localSession = null;
    console.log('[ServerManager] Stopping managed services...');

    await Promise.all([
      this.killProcessTree(this.backendProcess),
      this.killProcessTree(this.webProcess),
    ]);

    this.backendProcess = null;
    this.webProcess = null;
    console.log('[ServerManager] All managed services stopped.');
  }

  /**
   * Wire application and process termination events to guarantee clean teardown.
   */
  private setupTerminationHooks(): void {
    const handleExit = () => {
      void this.stopServices();
    };

    if (app) {
      app.on('before-quit', () => {
        if (this.quitGuard?.()) return;
        handleExit();
      });
      app.on('will-quit', handleExit);
      app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
          void this.stopServices().then(() => app.quit());
        }
      });
    }

    process.on('SIGINT', () => {
      void this.stopServices().then(() => process.exit(0));
    });
    process.on('SIGTERM', () => {
      void this.stopServices().then(() => process.exit(0));
    });
    process.on('exit', () => {
      void this.stopServices();
    });
  }
}
