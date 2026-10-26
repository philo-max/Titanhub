import { app, BrowserWindow, dialog, ipcMain, safeStorage, session } from 'electron';
import { WebDavSettings } from './webdav';
import { ServerManager } from './server-manager';
import { createMainWindow } from './window';
import { LOCAL_SESSION_CHANNEL, isTrustedSessionSender, requestRendererFlush } from './local-session';

const FLUSH_TIMEOUT_MS = 10000;
const QUIT_RETRY = 0;
const QUIT_DISCARD = 1;

function startDesktopApp(): void {
  let mainWindow: BrowserWindow | null = null;
  let currentBackendUrl = 'http://127.0.0.1:3001';
  let currentWebUrl = '';
  let quitPhase: 'running' | 'flushing' | 'ready' = 'running';
  const serverManager = new ServerManager();

  const hasLiveWindow = () => mainWindow !== null && !mainWindow.isDestroyed();
  serverManager.setQuitGuard(() => quitPhase !== 'ready' && hasLiveWindow());

  // IPC handlers
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:apiBase', () => currentBackendUrl);
  ipcMain.handle(LOCAL_SESSION_CHANNEL, (event) => {
    if (!isTrustedSessionSender(event, mainWindow, currentWebUrl)) {
      throw new Error('Local session request rejected.');
    }
    const session = serverManager.getLocalSession();
    if (!session) {
      throw new Error('Local session is not available.');
    }
    return session;
  });

  const webdavSettings = () => new WebDavSettings(app.getPath('userData'), safeStorage);
  const requireTrustedWebDavSender = (event: Electron.IpcMainInvokeEvent) => {
    if (!isTrustedSessionSender(event, mainWindow, currentWebUrl)) {
      throw new Error('WebDAV request rejected.');
    }
  };
  ipcMain.handle('webdav:config:get', (event) => {
    requireTrustedWebDavSender(event);
    return webdavSettings().read();
  });
  ipcMain.handle('webdav:config:save', (event, input: unknown) => {
    requireTrustedWebDavSender(event);
    return webdavSettings().save(input);
  });
  ipcMain.handle('webdav:test', (event) => {
    requireTrustedWebDavSender(event);
    return serverManager.requestWebDav('webdav:test', webdavSettings().getCredentials());
  });
  ipcMain.handle('webdav:sync', (event) => {
    requireTrustedWebDavSender(event);
    return serverManager.requestWebDav('webdav:sync', webdavSettings().getCredentials());
  });

  const requestQuit = async () => {
    if (quitPhase !== 'running') return;
    quitPhase = 'flushing';
    for (;;) {
      const flushed = await requestRendererFlush(mainWindow, ipcMain, currentWebUrl, FLUSH_TIMEOUT_MS);
      if (flushed) break;
      const options = {
        type: 'warning' as const,
        title: 'Titanhub',
        message: '部分收藏或进度尚未确认保存到本机。',
        detail: '可以重试保存；放弃则未确认的更改会丢失。',
        buttons: ['重试', '放弃未保存的更改并退出', '取消'],
        defaultId: QUIT_RETRY,
        cancelId: 2,
        noLink: true,
      };
      const { response } = hasLiveWindow()
        ? await dialog.showMessageBox(mainWindow!, options)
        : await dialog.showMessageBox(options);
      if (response === QUIT_RETRY) continue;
      if (response === QUIT_DISCARD) break;
      quitPhase = 'running';
      return;
    }
    quitPhase = 'ready';
    await serverManager.stopServices();
    app.exit(0);
  };

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('before-quit', (event) => {
    if (quitPhase === 'ready' || !hasLiveWindow()) return;
    event.preventDefault();
    void requestQuit();
  });

  app.whenReady().then(async () => {
    try {
      const { backendUrl, webUrl } = await serverManager.startServices();
      currentBackendUrl = backendUrl;
      currentWebUrl = webUrl;
      process.env.TITANHUB_API_BASE = backendUrl;

      if (process.env.TITANHUB_USE_SYSTEM_PROXY !== '1') {
        await session.defaultSession.setProxy({ mode: 'direct' });
      }

      mainWindow = createMainWindow(webUrl, backendUrl);

      if (process.argv.includes('--smoke-test')) {
        console.log(`[Desktop GUI Ready] backendUrl=${backendUrl} webUrl=${webUrl}`);
        mainWindow.once('ready-to-show', () => {
          console.log(`[Desktop GUI Window Shown] Title: ${mainWindow?.getTitle()}`);
          setTimeout(async () => {
            console.log('[Desktop GUI Smoke Test] Auto-quitting after successful GUI launch verification...');
            await serverManager.stopServices();
            app.exit(0);
          }, 2500);
        });
      }

      mainWindow.on('close', (event) => {
        if (quitPhase === 'ready') return;
        event.preventDefault();
        void requestQuit();
      });

      mainWindow.on('closed', () => {
        mainWindow = null;
      });
    } catch (err: any) {
      console.error('[Desktop Main Error]', err);
      dialog.showErrorBox(
        'Titanhub Startup Error',
        `Failed to initialize background services:\n${err?.message || String(err)}`
      );
      await serverManager.stopServices();
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) {
      // If reactivated without window, reopen if needed
    }
  });
}

// Enforce single instance
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  startDesktopApp();
}
