import { randomBytes } from 'node:crypto';
import { fetchWithValidatedTransport, isSafeUrl } from './sandbox';

export interface MangaImagePage {
  url: string;
  headers?: Record<string, string>;
}

export type MangaImageResult = string | MangaImagePage;

export interface MangaImageTokenStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export interface MangaImageFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

const FORWARDED_IMAGE_HEADERS = ['referer', 'user-agent'];
const IMAGE_TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_IMAGE_TOKENS = 5000;
const IMAGE_TOKEN_BYTES = 18;
const IMAGE_FETCH_TIMEOUT_MS = 20000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_REDIRECTS = 5;
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
const EXPIRED_TOKEN_MESSAGE = '图片链接已过期或无效，请重新打开本章节。';

class MangaImageProxyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function pickForwardedHeaders(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const picked: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const lower = name.toLowerCase();
    if (FORWARDED_IMAGE_HEADERS.includes(lower) && typeof value === 'string' && value && !/[\r\n]/.test(value)) {
      picked[lower] = value;
    }
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

export function normalizeImagePages(raw: unknown): MangaImagePage[] {
  if (!Array.isArray(raw)) throw new Error('Plugin getImages must return an array.');
  return raw.map((page, index) => {
    if (typeof page === 'string' && page) return { url: page };
    const url = page && typeof page === 'object' ? (page as MangaImagePage).url : undefined;
    if (typeof url !== 'string' || !url) throw new Error(`Invalid image page at index ${index}.`);
    const headers = pickForwardedHeaders((page as MangaImagePage).headers);
    return headers ? { url, headers } : { url };
  });
}

export class MangaImageTokenStore {
  private readonly entries = new Map<string, MangaImagePage & { expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: MangaImageTokenStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? IMAGE_TOKEN_TTL_MS;
    this.maxEntries = options.maxEntries ?? MAX_IMAGE_TOKENS;
    this.now = options.now ?? Date.now;
  }

  issue(page: MangaImagePage): string {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt > now && this.entries.size < this.maxEntries) break;
      this.entries.delete(token);
    }
    const token = randomBytes(IMAGE_TOKEN_BYTES).toString('base64url');
    this.entries.set(token, { ...page, expiresAt: now + this.ttlMs });
    return token;
  }

  resolve(token: string): MangaImagePage | null {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      return null;
    }
    return entry.headers ? { url: entry.url, headers: entry.headers } : { url: entry.url };
  }
}

export function toClientImageUrls(raw: unknown, apiBase: string, store: MangaImageTokenStore): string[] {
  return normalizeImagePages(raw).map((page) =>
    page.headers ? `${apiBase}/api/manga-images/${store.issue(page)}` : page.url
  );
}

function limitImageStream(source: ReadableStream<Uint8Array>, maxBytes: number, onDone: () => void): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          onDone();
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > maxBytes) {
          onDone();
          await reader.cancel();
          controller.error(new MangaImageProxyError(`Image exceeds ${maxBytes} bytes.`, 413));
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        onDone();
        controller.error(err);
      }
    },
    async cancel(reason) {
      onDone();
      await reader.cancel(reason);
    },
  });
}

async function discardBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    return;
  }
}

async function fetchMangaImage(page: MangaImagePage, options: MangaImageFetchOptions): Promise<Response> {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? IMAGE_FETCH_TIMEOUT_MS);
  const done = () => clearTimeout(timer);
  try {
    let currentUrl = page.url;
    for (let hop = 0; hop <= MAX_IMAGE_REDIRECTS; hop++) {
      if (!(await isSafeUrl(currentUrl, { allowPinnedFakeIp: true }))) {
        throw new MangaImageProxyError(`SecurityError: Image URL '${currentUrl}' is blocked by security policy.`, 403);
      }
      const res = await fetchWithValidatedTransport(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'image/*', ...page.headers },
      });
      if (REDIRECT_STATUSES.includes(res.status)) {
        const location = res.headers.get('location');
        await discardBody(res);
        if (!location) throw new MangaImageProxyError(`Redirect response (${res.status}) missing Location header.`, 502);
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (!res.ok) {
        await discardBody(res);
        throw new MangaImageProxyError(`Upstream image request failed: HTTP ${res.status}.`, 502);
      }
      const contentType = (res.headers.get('content-type') || '').trim();
      if (!/^image\//i.test(contentType)) {
        await discardBody(res);
        throw new MangaImageProxyError(`Upstream response is not an image (${contentType || 'unknown type'}).`, 415);
      }
      if (Number(res.headers.get('content-length')) > maxBytes) {
        await discardBody(res);
        throw new MangaImageProxyError(`Image exceeds ${maxBytes} bytes.`, 413);
      }
      if (!res.body) throw new MangaImageProxyError('Upstream image response has no body.', 502);
      return new Response(limitImageStream(res.body, maxBytes, done), {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'private, max-age=600',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; sandbox",
        },
      });
    }
    throw new MangaImageProxyError('Too many redirects while fetching image.', 502);
  } catch (err) {
    done();
    if (controller.signal.aborted) throw new MangaImageProxyError('Upstream image request timed out.', 504);
    throw err;
  }
}

export async function serveMangaImage(
  token: string,
  store: MangaImageTokenStore,
  options: MangaImageFetchOptions = {}
): Promise<Response> {
  const page = store.resolve(token);
  if (!page) return Response.json({ error: EXPIRED_TOKEN_MESSAGE }, { status: 410 });
  try {
    return await fetchMangaImage(page, options);
  } catch (err) {
    const status = err instanceof MangaImageProxyError ? err.status : 502;
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
