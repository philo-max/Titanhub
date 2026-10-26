import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const WEB_URL = 'http://127.0.0.1:3000';
const BACKEND_URL = 'http://127.0.0.1:3001';

const state = vi.hoisted(() => ({
  gotLock: true,
  handlers: new Map<string, (...args: any[]) => unknown>(),
  appEvents: new Map<string, (...args: any[]) => unknown>(),
  managerInstances: 0,
  session: { apiBase: 'http://127.0.0.1:3001', token: 't'.repeat(43) } as { apiBase: string; token: string } | null,
  stopServices: vi.fn(async () => {}),
  webdavRead: vi.fn(() => ({ url: 'https://dav.example/', username: 'reader', hasPassword: true, allowInsecureHttp: false })),
  webdavSave: vi.fn(),
  webdavCredentials: vi.fn(() => ({ url: 'https://dav.example/', username: 'reader', password: 'secret', allowInsecureHttp: false })),
  webdavRequest: vi.fn(async (_operation: unknown, _config: unknown) => ({ success: true, warnings: [] })),
  exit: vi.fn(),
  whenReady: vi.fn(),
  window: null as any,
  ipcMain: null as any,
  showMessageBox: vi.fn(async () => ({ response: 0 })),
  setProxy: vi.fn(async (_config: unknown) => {}),
}));

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('events');
  const ipcMain = new Emitter() as any;
  ipcMain.handle = (channel: string, fn: (...args: any[]) => unknown) => state.handlers.set(channel, fn);
  state.ipcMain = ipcMain;
  return {
    app: {
      requestSingleInstanceLock: () => state.gotLock,
      exit: state.exit,
      quit: vi.fn(),
      getVersion: () => '1.0.0',
      getPath: () => '/mock-profile',
      whenReady: state.whenReady,
      on: (event: string, fn: (...args: any[]) => unknown) => state.appEvents.set(event, fn),
    },
    BrowserWindow: { getAllWindows: () => [] },
    dialog: { showErrorBox: vi.fn(), showMessageBox: state.showMessageBox },
    ipcMain,
    safeStorage: {},
    session: { defaultSession: { setProxy: state.setProxy } },
  };
});

vi.mock('./server-manager', () => ({
  ServerManager: class {
    constructor() {
      state.managerInstances++;
    }
    setQuitGuard() {}
    getLocalSession() {
      return state.session;
    }
    startServices = async () => ({ backendUrl: BACKEND_URL, webUrl: WEB_URL });
    stopServices = state.stopServices;
    requestWebDav = state.webdavRequest;
  },
}));

vi.mock('./webdav', () => ({
  WebDavSettings: class {
    read = state.webdavRead;
    save = state.webdavSave;
    getCredentials = state.webdavCredentials;
  },
}));

vi.mock('./window', () => ({
  createMainWindow: () => state.window,
}));

function makeWindow() {
  const win = new EventEmitter() as any;
  const mainFrame = { routingId: 1, processId: 9, parent: null, url: `${WEB_URL}/` };
  win.webContents = { mainFrame, send: vi.fn() };
  win.isDestroyed = () => false;
  win.once = win.once.bind(win);
  return win;
}

async function bootReadyApp() {
  let readyCallback: (() => Promise<void>) | null = null;
  state.whenReady.mockReturnValue({ then: (cb: () => Promise<void>) => (readyCallback = cb) });
  await import('./index');
  await readyCallback!();
}

describe('desktop main entry', () => {
  beforeEach(() => {
    vi.resetModules();
    state.gotLock = true;
    state.handlers.clear();
    state.appEvents.clear();
    state.managerInstances = 0;
    state.session = { apiBase: BACKEND_URL, token: 't'.repeat(43) };
    state.stopServices.mockClear();
    state.webdavRead.mockClear();
    state.webdavSave.mockClear();
    state.webdavCredentials.mockClear();
    state.webdavRequest.mockClear();
    state.exit.mockClear();
    state.whenReady.mockReset();
    state.showMessageBox.mockReset();
    state.setProxy.mockClear();
    delete process.env.TITANHUB_USE_SYSTEM_PROXY;
    state.window = makeWindow();
  });

  it('stops immediately without starting services when the single-instance lock is lost', async () => {
    state.gotLock = false;
    await import('./index');
    expect(state.exit).toHaveBeenCalledWith(0);
    expect(state.managerInstances).toBe(0);
    expect(state.whenReady).not.toHaveBeenCalled();
    expect(state.handlers.size).toBe(0);
  });

  it('bypasses the system proxy for the web session unless explicitly opted in', async () => {
    await bootReadyApp();
    expect(state.setProxy).toHaveBeenCalledWith({ mode: 'direct' });
  });

  it('keeps the system proxy when TITANHUB_USE_SYSTEM_PROXY=1', async () => {
    process.env.TITANHUB_USE_SYSTEM_PROXY = '1';
    await bootReadyApp();
    expect(state.setProxy).not.toHaveBeenCalled();
  });

  it('hands the local session only to the main frame of the app window', async () => {
    await bootReadyApp();
    const handler = state.handlers.get('session:local')!;
    const { webContents } = state.window;

    expect(await handler({ sender: webContents, senderFrame: webContents.mainFrame })).toEqual(state.session);
    expect(() => handler({ sender: {}, senderFrame: webContents.mainFrame })).toThrow();
    expect(() =>
      handler({ sender: webContents, senderFrame: { ...webContents.mainFrame, routingId: 5, parent: webContents.mainFrame } })
    ).toThrow();
    expect(() =>
      handler({ sender: webContents, senderFrame: { ...webContents.mainFrame, url: 'https://evil.example/' } })
    ).toThrow();

    state.session = null;
    expect(() => handler({ sender: webContents, senderFrame: webContents.mainFrame })).toThrow();
  });

  it('restricts every WebDAV handler to the trusted main frame and only main supplies credentials', async () => {
    await bootReadyApp();
    const { webContents } = state.window;
    const trusted = { sender: webContents, senderFrame: webContents.mainFrame };
    const untrusted = [
      { sender: {}, senderFrame: webContents.mainFrame },
      { sender: webContents, senderFrame: { ...webContents.mainFrame, parent: webContents.mainFrame } },
      { sender: webContents, senderFrame: { ...webContents.mainFrame, url: 'https://evil.example/' } },
    ];
    for (const channel of ['webdav:config:get', 'webdav:config:save', 'webdav:test', 'webdav:sync']) {
      const handler = state.handlers.get(channel)!;
      expect(handler).toBeTypeOf('function');
      for (const event of untrusted) expect(() => handler(event, { password: 'renderer-secret' })).toThrow();
    }
    expect(state.webdavCredentials).not.toHaveBeenCalled();
    expect(await state.handlers.get('webdav:config:get')!(trusted)).not.toHaveProperty('password');
    const input = { url: 'https://dav.example/', username: 'reader', password: 'new-secret', allowInsecureHttp: false };
    await state.handlers.get('webdav:config:save')!(trusted, input);
    expect(state.webdavSave).toHaveBeenCalledWith(input);
    await state.handlers.get('webdav:test')!(trusted, { password: 'renderer-secret' });
    await state.handlers.get('webdav:sync')!(trusted, { password: 'renderer-secret' });
    expect(state.webdavRequest).toHaveBeenCalledWith('webdav:test', state.webdavCredentials());
    expect(state.webdavRequest).toHaveBeenCalledWith('webdav:sync', state.webdavCredentials());
    expect(state.webdavRequest).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ password: 'renderer-secret' }));
  });

  it('waits for the renderer flush confirmation before stopping the backend on window close', async () => {
    await bootReadyApp();
    const win = state.window;
    const closeEvent = { preventDefault: vi.fn() };
    win.emit('close', closeEvent);
    expect(closeEvent.preventDefault).toHaveBeenCalled();
    expect(state.stopServices).not.toHaveBeenCalled();

    const [channel, requestId] = win.webContents.send.mock.calls[0];
    expect(channel).toBe('app:flush-request');
    state.ipcMain.emit('app:flush-result', { sender: win.webContents, senderFrame: win.webContents.mainFrame }, requestId, true);
    await vi.waitFor(() => expect(state.exit).toHaveBeenCalledWith(0));
    expect(state.stopServices).toHaveBeenCalledTimes(1);
    expect(state.showMessageBox).not.toHaveBeenCalled();
  });

  it('offers retry when the flush fails and keeps running when the user cancels', async () => {
    await bootReadyApp();
    const win = state.window;
    state.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 2 });
    win.emit('close', { preventDefault: vi.fn() });

    const reply = (ok: boolean) => {
      const calls = win.webContents.send.mock.calls;
      const requestId = calls[calls.length - 1][1];
      state.ipcMain.emit('app:flush-result', { sender: win.webContents, senderFrame: win.webContents.mainFrame }, requestId, ok);
    };
    reply(false);
    await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledTimes(2));
    reply(false);
    await vi.waitFor(() => expect(state.showMessageBox).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 10));
    expect(state.stopServices).not.toHaveBeenCalled();
    expect(state.exit).not.toHaveBeenCalled();

    state.showMessageBox.mockResolvedValueOnce({ response: 1 });
    win.emit('close', { preventDefault: vi.fn() });
    reply(false);
    await vi.waitFor(() => expect(state.exit).toHaveBeenCalledWith(0));
    expect(state.stopServices).toHaveBeenCalledTimes(1);
  });
});
