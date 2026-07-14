import { chromium, Browser, Page, Request, Response, Route } from 'playwright';
import { isSafeUrl } from './sandbox';

// Ad hosts ported from Kazumi's webview _isAdUrl filter
const AD_URL_PATTERNS = ['googleads', 'googlesyndication', 'adtrafficquality', 'doubleclick'];
// A response claiming video/* from an image-extension URL is an inline ad trick
const FAKE_IMAGE_EXT = /\.(image|jpe?g|png|gif|webp)(?:[?#]|$)/i;

export class PlaywrightSniffer {
  private static browser: Browser | null = null;

  private static async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
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
   * big-play buttons. Muted playback keeps autoplay policies satisfied.
   */
  private static async activatePlayback(page: Page): Promise<void> {
    // Runs inside the page; DOM globals resolve at runtime, so keep it untyped
    const activateScript = `() => {
      const video = document.querySelector('video');
      if (video && video.paused) {
        video.muted = true;
        video.play().catch(() => {});
      }
      const selectors = [
        '.art-video-player .art-state',
        '.dplayer-play-icon',
        '.vjs-big-play-button',
        '.plyr__control--overlaid',
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

      // Filter out TS chunks or segments: .ts extensions or /segment /ts/ patterns
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
   * Sniff video stream URL by navigating to page and listening to requests/responses.
   */
  static async sniff(url: string, headers: Record<string, string> = {}): Promise<string> {
    const isSafe = await isSafeUrl(url);
    if (!isSafe) {
      throw new Error(`SecurityError: Access to URL '${url}' is blocked by sandbox policy.`);
    }

    let context: any = null;
    try {
      const browser = await this.getBrowser();

      // Extrude User-Agent and headers
      const userAgent = headers['User-Agent'] || headers['user-agent'] || undefined;
      const extraHTTPHeaders = Object.fromEntries(
        Object.entries(headers).filter(([k]) => k.toLowerCase() !== 'user-agent')
      );

      // Launch isolated context and page
      context = await browser.newContext({
        userAgent,
        extraHTTPHeaders,
      });

      const page = await context.newPage();
      // m3u8 manifests win immediately; bare media files (mp4/flv/...) are kept
      // as a fallback candidate since inline ads are often plain mp4 clips.
      let manifestUrl: string | null = null;
      let mediaFileUrl: string | null = null;

      // Intercept and block all local/intranet requests (SSRF mitigation)
      await page.route('**/*', async (route: Route) => {
        try {
          const reqUrl = route.request().url();
          const safe = await isSafeUrl(reqUrl);
          if (!safe) {
            await route.abort();
          } else {
            await route.continue();
          }
        } catch {
          await route.abort();
        }
      });

      // Listen to requests
      page.on('request', (request: Request) => {
        const reqUrl = request.url();
        if (this.isAdUrl(reqUrl)) return;
        const kind = this.classifyVideoUrl(reqUrl);
        if (kind === 'manifest') {
          manifestUrl = reqUrl;
        } else if (kind === 'file' && !mediaFileUrl) {
          mediaFileUrl = reqUrl;
        }
      });

      // Listen to responses for mime types as fallback
      page.on('response', (response: Response) => {
        const contentType = response.headers()['content-type'] || '';
        const resUrl = response.url();
        if (this.isAdUrl(resUrl)) return;
        // Additional safety check to avoid picking up TS segment files
        const isTs = resUrl.toLowerCase().endsWith('.ts') ||
                     /\.ts(?:[?#]|$)/i.test(resUrl) ||
                     /\/segment\b/i.test(resUrl) ||
                     /\bchunk\b/i.test(resUrl);
        if (isTs) return;
        if (
          contentType.includes('application/x-mpegURL') ||
          contentType.includes('application/vnd.apple.mpegurl')
        ) {
          manifestUrl = resUrl;
        } else if (contentType.startsWith('video/')) {
          if (!mediaFileUrl && !FAKE_IMAGE_EXT.test(resUrl)) {
            mediaFileUrl = resUrl;
          }
        }
      });

      // Navigate to page (waitUntil DOMContentLoaded to be faster)
      // Catch navigation failures (e.g. timeout) to avoid crashing execution
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

      // Poll until a manifest is found or timeout is reached, periodically
      // nudging players that wait for a user gesture before loading the stream
      const checkInterval = 200;
      const timeout = 15000;
      let elapsed = 0;
      let nextActivateAt = 3000;

      while (elapsed < timeout && !manifestUrl) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        elapsed += checkInterval;
        if (!manifestUrl && elapsed >= nextActivateAt) {
          nextActivateAt = elapsed + 3000;
          await this.activatePlayback(page);
        }
      }

      return manifestUrl || mediaFileUrl || '';
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
