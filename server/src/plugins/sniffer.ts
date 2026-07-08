import { chromium, Browser, Request, Response, Route } from 'playwright';
import { isSafeUrl } from './sandbox';

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
      let resolvedUrl: string | null = null;

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
        if (
          reqUrl.includes('.m3u8') ||
          reqUrl.includes('.mp4') ||
          reqUrl.includes('.flv') ||
          (reqUrl.includes('/play') && reqUrl.includes('m3u8'))
        ) {
          // Exclude segments/chunks to avoid picking up TS files
          if (!reqUrl.includes('.ts') && !reqUrl.includes('/segment')) {
            resolvedUrl = reqUrl;
          }
        }
      });

      // Listen to responses for mime types as fallback
      page.on('response', (response: Response) => {
        const contentType = response.headers()['content-type'] || '';
        const resUrl = response.url();
        if (
          contentType.includes('application/x-mpegURL') ||
          contentType.includes('application/vnd.apple.mpegurl') ||
          contentType.startsWith('video/')
        ) {
          if (!resUrl.includes('.ts') && !resUrl.includes('/segment')) {
            resolvedUrl = resUrl;
          }
        }
      });

      // Navigate to page (waitUntil DOMContentLoaded to be faster)
      // Catch navigation failures (e.g. timeout) to avoid crashing execution
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

      // Poll until video stream URL is found or timeout is reached
      const checkInterval = 200;
      const timeout = 15000;
      let elapsed = 0;

      while (elapsed < timeout && !resolvedUrl) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
        elapsed += checkInterval;
      }

      return resolvedUrl || '';
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
