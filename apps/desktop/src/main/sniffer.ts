import { BrowserWindow, session } from 'electron';

// Ad hosts ported from Kazumi's webview _isAdUrl filter
const AD_URL_PATTERNS = [
  'googleads',
  'googlesyndication',
  'adtrafficquality',
  'doubleclick',
  'pagead2',
];

interface SniffCacheEntry {
  url: string;
  expiresAt: number;
}
const sniffCache = new Map<string, SniffCacheEntry>();
const SNIFF_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const FILE_CANDIDATE_GRACE_MS = 1500;
const PROXY_DENIED_HEADER = 'x-titanhub-proxy-denied';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const ACTIVATE_SCRIPT = `(() => {
  try {
    const video = document.querySelector('video');
    if (video && video.paused) {
      video.muted = true;
      video.play().catch(() => {});
    }
    const selectors = [
      '.art-video-player .art-state',
      '.art-state',
      '.art-control-play',
      '.dplayer-play-icon',
      '.vjs-big-play-button',
      '.plyr__control--overlaid',
      '.jw-icon.jw-icon-display',
      '.jw-display-icon-container .jw-icon',
      '.ckplayer-plays',
      '#play-button',
      '.play-btn',
      '#play',
      'button[title*="play" i]',
      '.vjs-poster',
      'canvas',
    ];
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    }
  } catch (e) {}
})();`;

function isPrivateOrReservedIp(ip: string): boolean {
  const privateIpRegex =
    /^(0\.|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.|192\.0\.0\.|198\.(1[8-9])\.|(22[4-9]|23[0-9])\.|(24[0-9]|25[0-5])\.)/;
  if (privateIpRegex.test(ip)) return true;

  const normalized = ip.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc00:') ||
    normalized.startsWith('fd00:') ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('2001:db8:')
  );
}

import dns from 'node:dns/promises';

const dnsCache = new Map<string, { ip: string; expiresAt: number }>();
const DNS_CACHE_TTL_MS = 60_000;

export async function isSafeHostDns(hostname: string): Promise<boolean> {
  const normalized = hostname.toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '[::1]' ||
    normalized === '::1'
  ) {
    return false;
  }
  if (isPrivateOrReservedIp(normalized)) {
    return false;
  }
  if (!normalized.includes('.')) {
    return false;
  }

  const cached = dnsCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return !isPrivateOrReservedIp(cached.ip);
  }

  try {
    const lookup = await dns.lookup(normalized);
    dnsCache.set(normalized, {
      ip: lookup.address,
      expiresAt: Date.now() + DNS_CACHE_TTL_MS,
    });
    return !isPrivateOrReservedIp(lookup.address);
  } catch {
    return false;
  }
}

export function isSafeUrlForSniffing(urlString: string, options: { proxied?: boolean } = {}): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1'
    ) {
      return false;
    }
    if (isPrivateOrReservedIp(hostname)) {
      return false;
    }
    if (!hostname.includes('.')) {
      return false;
    }
    if (options.proxied) {
      return true;
    }

    const cached = dnsCache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) {
      return !isPrivateOrReservedIp(cached.ip);
    }

    return true;
  } catch {
    return false;
  }
}

export async function isSafeUrlForSniffingAsync(urlString: string): Promise<boolean> {
  if (!isSafeUrlForSniffing(urlString)) {
    return false;
  }
  try {
    const parsed = new URL(urlString);
    return await isSafeHostDns(parsed.hostname);
  } catch {
    return false;
  }
}

export class ElectronSniffer {
  private static isAdUrl(urlStr: string): boolean {
    const lower = urlStr.toLowerCase();
    return AD_URL_PATTERNS.some((p) => lower.includes(p));
  }

  private static isMediaUrl(urlStr: string): boolean {
    const cleanUrl = urlStr.split('?')[0].toLowerCase();
    if (cleanUrl.endsWith('.js') || cleanUrl.endsWith('.css') || cleanUrl.endsWith('.html')) {
      return false;
    }
    return (
      cleanUrl.endsWith('.m3u8') ||
      cleanUrl.endsWith('.mp4') ||
      cleanUrl.endsWith('.flv') ||
      cleanUrl.endsWith('.m4s') ||
      cleanUrl.includes('.m3u8')
    );
  }

  /**
   * Check if Electron Chromium sniffer engine is available.
   */
  static checkAvailability(): { available: boolean; engine: string; version: string } {
    return {
      available: true,
      engine: 'electron-chromium',
      version: process.versions.chrome || 'unknown',
    };
  }

  static classifyMediaResponse(urlStr: string, contentType: string): 'manifest' | 'file' | null {
    let pathname: string;
    try {
      pathname = new URL(urlStr).pathname.toLowerCase();
    } catch {
      return null;
    }
    const type = contentType.toLowerCase();
    if (ElectronSniffer.isAdUrl(urlStr)) return null;
    if (/\.(ts|m4s|js|css|html?)$/.test(pathname) || type.includes('mp2t') || type.startsWith('audio/') || type.startsWith('text/html')) {
      return null;
    }
    if (type.includes('mpegurl') || pathname.endsWith('.m3u8')) return 'manifest';
    if (type.startsWith('video/') || /\.(mp4|flv|webm|mkv)$/.test(pathname)) return 'file';
    return null;
  }

  static isLoopbackProxy(proxyUrl: string): boolean {
    return /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(proxyUrl);
  }

  static buildLoadOptions(customHeaders: Record<string, string> = {}): Electron.LoadURLOptions {
    let userAgent = DEFAULT_USER_AGENT;
    let httpReferrer: string | undefined;
    const extra: string[] = [];
    for (const [name, value] of Object.entries(customHeaders)) {
      if (typeof value !== 'string' || !value || /[\r\n]/.test(value)) continue;
      const lower = name.toLowerCase();
      if (lower === 'user-agent') userAgent = value;
      else if (lower === 'referer') httpReferrer = value;
      else if (!['host', 'content-length', 'connection'].includes(lower) && /^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)) {
        extra.push(`${name}: ${value}`);
      }
    }
    return {
      userAgent,
      ...(httpReferrer ? { httpReferrer } : {}),
      ...(extra.length ? { extraHeaders: `${extra.join('\n')}\n` } : {}),
    };
  }

  /**
   * Sniff video stream URL using Electron's built-in Chromium engine.
   */
  static async sniff(
    targetUrl: string,
    customHeaders?: Record<string, string>,
    timeoutMs = 25000,
    options: { proxyUrl?: string; signal?: AbortSignal } = {}
  ): Promise<string> {
    const cached = sniffCache.get(targetUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    const proxied = typeof options.proxyUrl === 'string';
    if (proxied && !ElectronSniffer.isLoopbackProxy(options.proxyUrl!)) {
      throw new Error('SecurityError: Sniffer proxy must be a loopback validating proxy.');
    }
    const isSafe = proxied
      ? isSafeUrlForSniffing(targetUrl, { proxied: true })
      : await isSafeUrlForSniffingAsync(targetUrl);
    if (!isSafe) {
      throw new Error(`SecurityError: Access to URL '${targetUrl}' is blocked by security policy.`);
    }
    if (options.signal?.aborted) {
      throw new Error(`Sniffer cancelled for ${targetUrl}`);
    }

    const partition = `temp-sniffer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const ses = session.fromPartition(partition, { cache: false });
    if (proxied) {
      await ses.setProxy({ proxyRules: options.proxyUrl!, proxyBypassRules: '<-loopback>' });
    }

    return new Promise<string>((resolve, reject) => {
      let resolved = false;
      let timer: NodeJS.Timeout | null = null;
      let nudgeInterval: NodeJS.Timeout | null = null;
      let fileGraceTimer: NodeJS.Timeout | null = null;
      let fileCandidate: string | null = null;
      let win: BrowserWindow | null = null;

      const onAbort = () => finishError(new Error(`Sniffer cancelled for ${targetUrl}`));

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (nudgeInterval) clearInterval(nudgeInterval);
        if (fileGraceTimer) clearTimeout(fileGraceTimer);
        options.signal?.removeEventListener('abort', onAbort);
        if (win && !win.isDestroyed()) {
          try {
            win.destroy();
          } catch {}
        }
        win = null;
        ses.webRequest.onBeforeRequest(null);
        ses.webRequest.onHeadersReceived(null);
        void ses.closeAllConnections().catch(() => {});
        void ses.clearStorageData().catch(() => {});
      };

      const finishSuccess = (mediaUrl: string) => {
        if (resolved) return;
        resolved = true;
        sniffCache.set(targetUrl, {
          url: mediaUrl,
          expiresAt: Date.now() + SNIFF_CACHE_TTL_MS,
        });
        cleanup();
        resolve(mediaUrl);
      };

      const finishError = (err: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(err);
      };

      const acceptCandidate = (mediaUrl: string, kind: 'manifest' | 'file') => {
        if (kind === 'manifest') {
          finishSuccess(mediaUrl);
          return;
        }
        if (fileCandidate) return;
        fileCandidate = mediaUrl;
        fileGraceTimer = setTimeout(() => finishSuccess(mediaUrl), FILE_CANDIDATE_GRACE_MS);
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        finishError(new Error(`Sniffer timed out after ${timeoutMs}ms for ${targetUrl}`));
      }, timeoutMs);

      try {
        ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
          const reqUrl = details.url;
          if (!isSafeUrlForSniffing(reqUrl, { proxied })) {
            callback({ cancel: true });
            return;
          }
          if (!proxied && !ElectronSniffer.isAdUrl(reqUrl) && ElectronSniffer.isMediaUrl(reqUrl)) {
            finishSuccess(reqUrl);
          }
          callback({});
        });

        ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
          const headers = details.responseHeaders || {};
          const contentType = Object.keys(headers).find(
            (k) => k.toLowerCase() === 'content-type'
          );
          const val = contentType ? (headers[contentType][0] || '').toLowerCase() : '';
          if (proxied && details.resourceType === 'mainFrame' && Object.keys(headers).some((k) => k.toLowerCase() === PROXY_DENIED_HEADER)) {
            callback({ cancel: true });
            finishError(new Error(`SecurityError: Validating proxy blocked '${details.url}'.`));
            return;
          }
          const ok = details.statusCode >= 200 && details.statusCode < 300;
          const kind = ok ? ElectronSniffer.classifyMediaResponse(details.url, val) : null;
          if (kind && isSafeUrlForSniffing(details.url, { proxied })) {
            acceptCandidate(details.url, kind);
          }
          callback({});
        });

        win = new BrowserWindow({
          show: false,
          width: 1280,
          height: 720,
          webPreferences: {
            session: ses,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            images: false,
            webSecurity: true,
          },
        });
        win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

        win.webContents.on('will-navigate', (event, navigationUrl) => {
          if (!isSafeUrlForSniffing(navigationUrl, { proxied })) {
            event.preventDefault();
            console.warn(`[ElectronSniffer] Blocked unsafe navigation to: ${navigationUrl}`);
          }
        });

        win.webContents.on('will-redirect', (event, redirectUrl) => {
          if (!isSafeUrlForSniffing(redirectUrl, { proxied })) {
            event.preventDefault();
            console.warn(`[ElectronSniffer] Blocked unsafe redirect to: ${redirectUrl}`);
          }
        });

        win.webContents.on('dom-ready', () => {
          if (nudgeInterval) return;
          nudgeInterval = setInterval(() => {
            if (!win || win.isDestroyed()) return;
            for (const frame of win.webContents.mainFrame.framesInSubtree) {
              frame.executeJavaScript(ACTIVATE_SCRIPT).catch(() => {});
            }
          }, 800);
        });

        win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
          if (errorCode === -3) return;
          console.warn(`[ElectronSniffer] Failed loading ${validatedURL}: ${errorDescription}`);
          if (isMainFrame) {
            finishError(new Error(`Sniffer page failed to load (${errorDescription}) for ${targetUrl}`));
          }
        });

        void win.loadURL(targetUrl, ElectronSniffer.buildLoadOptions(customHeaders)).catch(() => {});
      } catch (err: any) {
        finishError(err);
      }
    });
  }
}
