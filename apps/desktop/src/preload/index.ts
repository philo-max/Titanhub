import { contextBridge, ipcRenderer } from 'electron';

// Parse synchronous --api-base argument injected via additionalArguments
let apiBase = '';
for (const arg of process.argv) {
  if (arg.startsWith('--api-base=')) {
    apiBase = arg.slice('--api-base='.length);
    break;
  }
}

let flushHandler: (() => Promise<unknown>) | null = null;

ipcRenderer.on('app:flush-request', async (_event, requestId: string) => {
  let ok = true;
  if (flushHandler) {
    try {
      ok = (await flushHandler()) === true;
    } catch {
      ok = false;
    }
  }
  ipcRenderer.send('app:flush-result', requestId, ok);
});

contextBridge.exposeInMainWorld('titanhubDesktop', {
  isDesktop: true,
  platform: process.platform,
  apiBase, // Synchronous string guaranteed
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getLocalSession: () => ipcRenderer.invoke('session:local'),
  getWebDavConfig: () => ipcRenderer.invoke('webdav:config:get'),
  saveWebDavConfig: (input: unknown) => ipcRenderer.invoke('webdav:config:save', input),
  testWebDav: () => ipcRenderer.invoke('webdav:test'),
  syncWebDav: () => ipcRenderer.invoke('webdav:sync'),
  setFlushHandler: (handler: unknown) => {
    flushHandler = typeof handler === 'function' ? (handler as () => Promise<unknown>) : null;
  },
});
