import { BrowserWindow, shell } from 'electron';
import path from 'path';

export function createMainWindow(loadUrl: string, backendUrl?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'Titanhub',
    backgroundColor: '#08090a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      additionalArguments: backendUrl ? [`--api-base=${backendUrl}`] : [],
    },
  });

  // Open external links in default browser rather than inside app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Append apiBase query parameter so the frontend client immediately picks it up
  const targetUrl = backendUrl
    ? `${loadUrl}${loadUrl.includes('?') ? '&' : '?'}apiBase=${encodeURIComponent(backendUrl)}`
    : loadUrl;

  void win.loadURL(targetUrl);

  return win;
}
