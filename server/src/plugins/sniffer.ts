import type { Browser, Page, Request, Response } from 'playwright';
import { fetchWithValidatedTransport, isSafeUrl, resolveValidatedAddress } from './sandbox';
import { buildExternalProcessEnv } from '../auth/local-session';
import { startValidatingProxy, type AddressResolver } from './validating-proxy';

// Ad hosts ported from Kazumi's webview _isAdUrl filter
const AD_URL_PATTERNS = ['googleads', 'googlesyndication', 'adtrafficquality', 'doubleclick', 'pagead2'];

// ─── Sniff result cache ───
// Sniffing is expensive (10-25s per page). Cache the result so repeated
// access to the same episode within the TTL window returns instantly.
// Default TTL is 30 minutes — video CDN URLs typically expire in 1-2 hours,
// so 30 min is a safe window.
interface SniffCacheEntry {
  url: string;
  expiresAt: number;
}
const sniffCache = new Map<string, SniffCacheEntry>();
const SNIFF_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SNIFF_TIMEOUT_MS = 25000;
const IPC_GRACE_MS = 5000;
const MAX_CONCURRENT_SNIFFS = 2;

function explicitProxyUrl(): string | undefined {
  return process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || undefined;
}

export class PlaywrightSniffer {
  private static browser: Browser | null = null;
  static resolveAddress: AddressResolver = resolveValidatedAddress;
  private static inFlight = new Map<string, Promise<string>>();
  private static activeSniffs = 0;
  private static waiting: Array<() => void> = [];

  private static async withSlot<T>(task: () => Promise<T>): Promise<T> {
    while (this.activeSniffs >= MAX_CONCURRENT_SNIFFS) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.activeSniffs++;
    try {
      return await task();
    } finally {
      this.activeSniffs--;
      this.waiting.shift()?.();
    }
  }

  private static async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const launchOptions: any = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        env: buildExternalProcessEnv(process.env),
      };
      
      const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
      if (proxyUrl) {
        launchOptions.proxy = { server: proxyUrl };
      }

      const { chromium } = await import('playwright');
      this.browser = await chromium.launch(launchOptions);
    }
    return this.browser;
  }

  private static isAdUrl(urlStr: string): boolean {
    const lower = urlStr.toLowerCase();
    return AD_URL_PATTERNS.some((p) => lower.includes(p));
  }

  /**
   * Many site players only start requesting the stream after a user gesture.
   * Nudge every frame: muted-play the <video> and click well-known player
   * big-play buttons. Covers ArtPlayer, DPlayer, Video.js, Plyr, jPlayer,
   * CKPlayer, and custom Chinese CMS players (MacPlayer/MizhiPlayer).
   */
  private static async activatePlayback(page: Page): Promise<void> {
    const activateScript = `() => {
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
        if (el) { el.click(); break; }
      }
    }`;
    for (const frame of page.frames()) {
      try {
        await frame.evaluate(activateScript);
      } catch {
        // Frame may be mid-navigation or cross-origin restricted; skip it
      }
    }
  }

  /**
   * Classify a URL as an HLS manifest, a direct media file, or neither.
   * Only the pathname is matched (mirrors Kazumi's `uri.path.endsWith('.m3u8')`):
   * matching the full URL string would misfire on parser intermediate pages
   * like `https://host/m3u8/?url=https://cdn/real/index.m3u8`.
   */
  private static classifyVideoUrl(urlStr: string): 'manifest' | 'file' | null {
    try {
      const parsed = new URL(urlStr);
      const pathname = parsed.pathname.toLowerCase();

      // Filter out TS chunks or segments
      const isTsSegment = pathname.endsWith('.ts') ||
                          /\/segment\b/.test(pathname) ||
                          /\/ts\//.test(pathname) ||
                          /\bchunk\b/.test(pathname);
      if (isTsSegment) return null;

      if (pathname.endsWith('.m3u8')) return 'manifest';
      if (/\.(mp4|flv|mkv|webm)$/.test(pathname)) return 'file';
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Verify that a URL actually points to a video/audio stream by making a
   * HEAD request and checking the Content-Type header.
   *
   * This prevents false positives where a CDN URL (e.g. ByteDance's
   * `~tplv-...-image.image`) is served with Content-Type: image/* instead
   * of video/*. The sniffer may capture these as candidate URLs based on
   * request patterns, but they are actually placeholder/error images.
   *
   * Returns the original URL if verification passes, or null if the URL
   * points to a non-video resource.
   */
  private static async verifyVideoUrl(urlStr: string): Promise<string | null> {
    try {
      if (!(await isSafeUrl(urlStr, { allowPinnedFakeIp: !explicitProxyUrl() }))) return null;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const fetchOptions: any = {
        method: 'HEAD',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      };

      const proxyUrl = process.env.PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
      if (proxyUrl) {
        const { ProxyAgent } = require('undici');
        fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
      }

      const res = proxyUrl ? await fetch(urlStr, fetchOptions) : await fetchWithValidatedTransport(urlStr, fetchOptions);
      clearTimeout(timeoutId);
      const ct = (res.headers.get('content-type') || '').toLowerCase();

      // HLS manifests
      if (ct.includes('application/x-mpegurl') || ct.includes('application/vnd.apple.mpegurl')) {
        return urlStr;
      }
      // Direct video files
      if (ct.startsWith('video/')) {
        return urlStr;
      }
      // Some CDNs return application/octet-stream for video content
      if (ct.includes('octet-stream')) {
        return urlStr;
      }
      // If HEAD not supported (405), trust the original classification
      if (res.status === 405 || res.status === 403) {
        return urlStr;
      }
      // Explicitly reject images
      if (ct.startsWith('image/')) {
        return null;
      }
      // Unknown content-type — be conservative, reject
      return null;
    } catch {
      // If HEAD request fails entirely (network error, abort), trust the
      // original URL classification rather than discarding a potentially
      // valid video URL
      return urlStr;
    }
  }

  /**
   * Sniff video stream URL by navigating to page and listening to requests/responses.
   *
   * Key design decisions learned from debugging gugu3 and similar Chinese CMS sites:
   * 1. Do NOT block CSS — player UI (ArtPlayer/DPlayer) needs CSS to render the play button
   * 2. Do NOT filter by URL extension on responses — CDN URLs like ByteDance's
   *    `~tplv-mdko3gqilj-image.image` serve video/mp4 despite the `.image` suffix
   * 3. Trust Content-Type over URL path for response classification
   * 4. Skip per-request SSRF route interception — it adds ~50ms per request and
   *    breaks timing-sensitive player initialization. The initial URL is already
   *    validated by isSafeUrl before navigation.
   * 5. After capturing a candidate URL, verify it with a HEAD request to confirm
   *    the Content-Type is actually video/* or application/x-mpegURL. This prevents
   *    returning placeholder/error images that share CDN URL patterns with videos.
   */
  /**
   * Delegate sniffing to Electron's Chromium instance via IPC channel.
   */
  private static sniffViaElectronIpc(
    url: string,
    headers: Record<string, string> = {},
    proxyUrl?: string,
    timeoutMs = SNIFF_TIMEOUT_MS
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2, 9);
      let timer: NodeJS.Timeout | null = setTimeout(() => {
        process.removeListener('message', handler);
        process.send?.({ type: 'sniff_cancel', id });
        reject(new Error(`[ElectronSniffer IPC] Sniffing timed out after ${timeoutMs}ms for ${url}`));
      }, timeoutMs + IPC_GRACE_MS);

      const handler = (msg: any) => {
        if (msg && msg.type === 'sniff_response' && msg.id === id) {
          if (timer) clearTimeout(timer);
          timer = null;
          process.removeListener('message', handler);
          if (msg.success && msg.url) {
            resolve(msg.url);
          } else {
            reject(new Error(msg.error || 'Electron sniffer failed to find video stream'));
          }
        }
      };

      process.on('message', handler);
      process.send!({ type: 'sniff', id, url, headers, proxy: proxyUrl, timeoutMs });
    });
  }

  /**
   * Check status and availability of the current sniffing engine.
   */
  static async checkEngine(): Promise<{ available: boolean; engine: string; version?: string; error?: string }> {
    if (process.env.TITANHUB_DESKTOP === '1' && typeof process.send === 'function') {
      return new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2, 9);
        const timer = setTimeout(() => {
          resolve({ available: true, engine: 'electron-chromium' });
        }, 3000);

        const handler = (msg: any) => {
          if (msg && msg.type === 'sniff_check_response' && msg.id === id) {
            clearTimeout(timer);
            process.removeListener('message', handler);
            resolve({ available: msg.available, engine: msg.engine, version: msg.version });
          }
        };
        process.on('message', handler);
        process.send!({ type: 'sniff_check', id });
      });
    }

    try {
      await import('playwright');
      return { available: true, engine: 'playwright-chromium' };
    } catch (err: any) {
      return { available: false, engine: 'none', error: err?.message };
    }
  }

  static async sniff(url: string, headers: Record<string, string> = {}): Promise<string> {
    // Check cache first — if we've recently sniffed this URL, return cached result
    const cached = sniffCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.url;
    }

    const pending = this.inFlight.get(url);
    if (pending) return pending;
    const task = this.withSlot(() => this.sniffUncached(url, headers)).finally(() => this.inFlight.delete(url));
    this.inFlight.set(url, task);
    return task;
  }

  private static async sniffUncached(url: string, headers: Record<string, string>): Promise<string> {
    const allowPinnedFakeIp = !explicitProxyUrl();
    const isSafe = await isSafeUrl(url, { allowPinnedFakeIp });
    if (!isSafe) {
      throw new Error(`SecurityError: Access to URL '${url}' is blocked by sandbox policy.`);
    }

    const proxy = allowPinnedFakeIp ? await startValidatingProxy(this.resolveAddress) : null;
    try {
      let found: string;
      if (process.env.TITANHUB_DESKTOP === '1' && typeof process.send === 'function') {
        console.log(`[Sniffer] Desktop mode detected: Delegating '${url}' to Electron Chromium...`);
        found = await this.sniffViaElectronIpc(url, headers, proxy?.url);
      } else {
        found = await this.sniffWithPlaywright(url, headers, proxy?.url);
      }
      if (found && !(await isSafeUrl(found, { allowPinnedFakeIp }))) {
        throw new Error(`SecurityError: Sniffed media URL '${found}' is blocked by sandbox policy.`);
      }
      if (found) sniffCache.set(url, { url: found, expiresAt: Date.now() + SNIFF_CACHE_TTL_MS });
      return found;
    } finally {
      await proxy?.close();
    }
  }

  private static async sniffWithPlaywright(url: string, headers: Record<string, string>, proxyServer?: string): Promise<string> {
    let context: Awaited<ReturnType<Browser['newContext']>> | null = null;
    try {
      const browser = await this.getBrowser();

      const userAgent = headers['User-Agent'] || headers['user-agent'] || undefined;
      const extraHTTPHeaders = Object.fromEntries(
        Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'user-agent')
      );

      context = await browser.newContext({
        userAgent,
        extraHTTPHeaders,
        viewport: { width: 1280, height: 720 },
        ...(proxyServer ? { proxy: { server: proxyServer, bypass: '<-loopback>' } } : {}),
      });

      // Only block images and fonts — NOT CSS.
      // CSS is essential for player UI rendering (ArtPlayer, DPlayer, etc.).
      // Blocking CSS prevents the play button from appearing, which means
      // activatePlayback() can never trigger the video stream request.
      await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,eot,avif}', (route: { abort: () => Promise<void> }) => {
        route.abort().catch(() => {});
      });

      const page = await context.newPage();

      let manifestUrl: string | null = null;
      let mediaFileUrl: string | null = null;
      // Track whether the URL was verified via response Content-Type
      // (Playwright already saw the actual HTTP response) vs URL-path heuristic
      // (request only, Content-Type unknown — needs HEAD verification).
      let manifestVerified = false;
      let mediaFileVerified = false;

      // Listen to requests — classify by URL path
      page.on('request', (request: Request) => {
        const reqUrl = request.url();
        if (this.isAdUrl(reqUrl)) return;
        const kind = this.classifyVideoUrl(reqUrl);
        if (kind) console.log(`[Sniffer] Request matched by path (${kind}):`, reqUrl);
        if (kind === 'manifest') {
          if (!manifestUrl) manifestUrl = reqUrl;
        } else if (kind === 'file' && !mediaFileUrl) {
          mediaFileUrl = reqUrl;
        }
      });

      // Listen to responses — classify by Content-Type header
      // This is the primary detection method for CDN URLs that don't have
      // standard video file extensions (e.g. ByteDance CDN serves video/mp4
      // from URLs ending in `.image`).
      page.on('response', (response: Response) => {
        const contentType = response.headers()['content-type'] || '';
        const resUrl = response.url();
        if (this.isAdUrl(resUrl)) return;

        // Skip TS segments
        const isTs = resUrl.toLowerCase().endsWith('.ts') ||
                     /\.ts(?:[?#]|$)/i.test(resUrl) ||
                     /\/segment\b/i.test(resUrl) ||
                     /\bchunk\b/i.test(resUrl);
        if (isTs) return;

        if (
          contentType.includes('application/x-mpegURL') ||
          contentType.includes('application/vnd.apple.mpegurl')
        ) {
          console.log(`[Sniffer] Response matched by Content-Type (manifest):`, resUrl);
          manifestUrl = resUrl;
          manifestVerified = true;
        } else if (contentType.startsWith('video/')) {
          console.log(`[Sniffer] Response matched by Content-Type (video):`, resUrl);
          if (!mediaFileUrl) {
            mediaFileUrl = resUrl;
            mediaFileVerified = true;
          }
        }
      });

      // Navigate to page
      console.log(`[Sniffer] Navigating to:`, url);
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => console.log(`[Sniffer] goto error:`, e));

      // Poll until any video URL (manifest or direct file) is found or
      // timeout is reached, periodically nudging players that wait for a
      // user gesture before loading the stream.
      // Timeout is 25s: some sites take 5-8s for player init + 3-5s for
      // the video URL resolution API to respond.
      const checkInterval = 200;
      const timeout = SNIFF_TIMEOUT_MS;
      let elapsed = 0;
      let nextActivateAt = 3000;

      while (elapsed < timeout && !manifestUrl && !mediaFileUrl) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        elapsed += checkInterval;
        if (!manifestUrl && !mediaFileUrl && elapsed >= nextActivateAt) {
          nextActivateAt = elapsed + 3000;
          await this.activatePlayback(page);
        }
      }

      if (!manifestUrl && !mediaFileUrl) {
        console.log(`[Sniffer] Timeout reached for:`, url);
        throw new Error(`Sniffer timeout: Could not find video stream for '${url}'`);
      }

      // Return the first available candidate. URLs captured via response
      // events are already verified (Playwright saw the actual Content-Type).
      // URLs captured via request events only (URL-path heuristic) get a
      // HEAD verification as a safety check.
      
      const candidates = [
        { url: manifestUrl, verified: manifestVerified },
        { url: mediaFileUrl, verified: mediaFileVerified }
      ];

      for (const { url: finalUrl, verified } of candidates) {
        if (finalUrl) {
          console.log(`[Sniffer] Found video URL:`, finalUrl);
          if (!verified) {
            console.log(`[Sniffer] Verifying URL with HEAD request:`, finalUrl);
            const verifiedUrl = await this.verifyVideoUrl(finalUrl);
            if (!verifiedUrl) {
              console.log(`[Sniffer] Verification failed (likely image), continuing...`);
              continue;
            }
          }

          return finalUrl;
        }
      }

      return '';
    } catch (e) {
      console.error('[PlaywrightSniffer Error]', e);
      return '';
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
    }
  }

  /**
   * Close the browser process completely.
   */
  static async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}
