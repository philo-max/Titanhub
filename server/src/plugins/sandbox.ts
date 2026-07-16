import { getQuickJS, QuickJSContext } from 'quickjs-emscripten';
import { PlaywrightSniffer } from './sniffer';
import dns from 'dns/promises';
import crypto from 'crypto';

export interface SandboxResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// xmldom serializes empty elements as self-closing (<div/>), but fragments we
// hand back get re-parsed with HTML semantics where <div/> is an OPEN tag that
// swallows all following siblings, corrupting positional XPath on sub-selects.
// Expand them to <tag></tag>; stray close tags on void elements are ignored by
// the HTML parser, so expanding unconditionally is safe.
function expandSelfClosingTags(xml: string): string {
  return xml.replace(
    /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)\/>/g,
    '<$1$2></$1>'
  );
}

function executeXPath(html: string, expression: string): any[] {
  try {
    const cheerio = require('cheerio');
    const xpath = require('xpath');
    const { DOMParser } = require('@xmldom/xmldom');

    // 1. Clean HTML and output well-formed XML using cheerio.
    // Strip default xmlns declarations: namespaced elements would make
    // unprefixed XPath expressions (//div, //a) silently match nothing.
    const $ = cheerio.load(html);
    const xhtml = $.xml().replace(/\sxmlns="[^"]*"/g, '');

    // 2. Parse to DOM
    const doc = new DOMParser({
      onError: (level: string, msg: string) => {
        if (level === 'fatal') {
          throw new Error(msg);
        }
      },
    }).parseFromString(xhtml, 'text/xml');

    // 3. Evaluate XPath
    const select = xpath.useNamespaces({});
    const result = select(expression, doc);

    if (!Array.isArray(result)) {
      return [];
    }

    return result.map((node: any) => {
      if (node.nodeType === 2) {
        // Attribute node
        return {
          text: node.nodeValue || '',
          html: '',
          attrs: {},
        };
      } else if (node.nodeType === 3) {
        // Text node
        return {
          text: node.nodeValue || '',
          html: '',
          attrs: {},
        };
      } else if (node.nodeType === 1) {
        // Element node
        const attrs: Record<string, string> = {};
        if (node.attributes) {
          for (let i = 0; i < node.attributes.length; i++) {
            const attr = node.attributes.item(i);
            if (attr) {
              attrs[attr.nodeName] = attr.nodeValue || '';
            }
          }
        }
        return {
          text: node.textContent?.trim() || '',
          html: expandSelfClosingTags(node.toString() || ''),
          attrs,
        };
      }
      return {
        text: node.toString() || '',
        html: '',
        attrs: {},
      };
    });
  } catch (err) {
    console.error('[Sandbox executeXPath Error]', err);
    return [];
  }
}

interface DnsCacheEntry {
  ip: string;
  expiresAt: number;
}

const dnsCache = new Map<string, DnsCacheEntry>();
const DNS_CACHE_TTL_MS = 30000; // 30 seconds

// Domain-specific rate limiting registry
const domainLastRequestTime = new Map<string, number>();
const DOMAIN_MIN_INTERVAL: Record<string, number> = {
  'api.mangadex.org': 250, // Max 4 requests per second to stay safely under 5 req/s limit
};

// ─── Fetch hardening constants (scraping resilience + security) ───
const FETCH_TIMEOUT_MS = 15000; // Per-request timeout
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB response body limit
const DEFAULT_RATE_LIMIT_MS = 100; // Default minimum interval between requests to the same domain
const MAX_FETCH_RETRIES = 2; // Max retries on 429/503
const RETRY_BASE_DELAY_MS = 500; // Base delay for exponential backoff
const MAX_REDIRECTS = 5; // Max redirect chain length

// ─── Simple TTL response cache for GET requests ───
interface CacheEntry {
  status: number;
  body: string;
  expiresAt: number;
}
const responseCache = new Map<string, CacheEntry>();
const RESPONSE_CACHE_TTL_MS = 60000; // 1 minute default TTL
const RESPONSE_CACHE_MAX_ENTRIES = 200;

function getCachedResponse(url: string): CacheEntry | null {
  const entry = responseCache.get(url);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    responseCache.delete(url);
    return null;
  }
  return entry;
}

function setCachedResponse(url: string, status: number, body: string, ttlMs: number = RESPONSE_CACHE_TTL_MS): void {
  // Evict oldest entries if cache is full (simple LRU-ish)
  if (responseCache.size >= RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(url, { status, body, expiresAt: Date.now() + ttlMs });
}

/**
 * Hardened fetch with timeout, redirect validation, size limit, and retry.
 * Each redirect target is validated through isSafeUrl to prevent SSRF via 302.
 */
async function hardenedFetch(
  url: string,
  options: any,
  pluginId: string
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const method = (options.method || 'GET').toUpperCase();

  // Check cache for GET requests without explicit cache-busting headers
  if (method === 'GET') {
    const cached = getCachedResponse(url);
    if (cached) {
      return { status: cached.status, body: cached.body, headers: {} };
    }
  }

  let currentUrl = url;
  let redirectCount = 0;
  let lastHeaders: Record<string, string> = {};

  while (redirectCount <= MAX_REDIRECTS) {
    // Validate every URL in the chain (prevents SSRF via redirect to internal IPs)
    const isSafe = await isSafeUrl(currentUrl);
    if (!isSafe) {
      throw new Error(`SecurityError: URL '${currentUrl}' is blocked by sandbox policy.`);
    }

    // Apply rate limiting (domain-specific or default)
    try {
      const parsedUrl = new URL(currentUrl);
      const hostname = parsedUrl.hostname.toLowerCase();
      const minInterval = DOMAIN_MIN_INTERVAL[hostname] || DEFAULT_RATE_LIMIT_MS;
      const lastTime = domainLastRequestTime.get(hostname) || 0;
      const now = Date.now();
      const targetTime = Math.max(now, lastTime + minInterval);
      domainLastRequestTime.set(hostname, targetTime);
      const delay = targetTime - now;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch {}

    // Attach cookies from the per-plugin cookie jar
    const cookieStr = getCookiesForRequest(pluginId, currentUrl);
    if (cookieStr) {
      const existingHeaders = (options.headers || {}) as Record<string, string>;
      const hasCookie = Object.keys(existingHeaders).some(
        (k) => k.toLowerCase() === 'cookie'
      );
      if (!hasCookie) {
        existingHeaders['Cookie'] = cookieStr;
        options.headers = existingHeaders;
      }
    }

    // Retry loop for transient failures (429, 503)
    let lastError: Error | null = null;
    let res: Response | null = null;

    for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        res = await fetch(currentUrl, {
          ...options,
          method,
          redirect: 'manual', // Manually follow redirects to validate each hop
          signal: controller.signal,
        });
        lastHeaders = {};
        // Safely extract headers (supports both standard Headers and plain objects)
        try {
          if (res.headers && typeof res.headers.forEach === 'function') {
            res.headers.forEach((value: string, key: string) => {
              lastHeaders[key.toLowerCase()] = value;
            });
          }
        } catch {}

        // Parse Set-Cookie headers
        try {
          const setCookie = res.headers?.get?.('set-cookie');
          if (setCookie) {
            parseSetCookie(pluginId, currentUrl, setCookie);
          }
        } catch {}

        // Retry on 429 (Too Many Requests) or 503 (Service Unavailable)
        if ((res.status === 429 || res.status === 503) && attempt < MAX_FETCH_RETRIES) {
          const retryAfter = parseInt(res.headers?.get?.('retry-after') || '0', 10);
          const delay = retryAfter > 0
            ? retryAfter * 1000
            : RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        break; // Success or non-retryable status
      } catch (err: any) {
        lastError = err;
        if (attempt < MAX_FETCH_RETRIES) {
          await new Promise((resolve) =>
            setTimeout(resolve, RETRY_BASE_DELAY_MS * Math.pow(2, attempt))
          );
          continue;
        }
        throw new Error(`Fetch failed after ${MAX_FETCH_RETRIES + 1} attempts: ${err.message}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!res) {
      throw lastError || new Error('Fetch failed without response.');
    }

    // Handle redirects manually
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers?.get?.('location') || (res.headers as any)?.location;
      if (!location) {
        throw new Error(`Redirect response ${res.status} missing Location header.`);
      }
      // Resolve relative redirect URLs
      currentUrl = new URL(location, currentUrl).href;
      redirectCount++;
      // For 303, switch to GET
      if (res.status === 303) {
        options.method = 'GET';
        delete options.body;
      }
      continue;
    }

    // Read body with size limit
    // Support both standard Response (with body.getReader) and mock responses (with text())
    let body: string;
    const reader = res.body?.getReader;

    if (typeof reader === 'function') {
      // Standard ReadableStream — read with size enforcement
      const streamReader = res.body!.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let sizeExceeded = false;

      for (;;) {
        const { done, value } = await streamReader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          sizeExceeded = true;
          break;
        }
        chunks.push(value);
      }

      if (sizeExceeded) {
        throw new Error(
          `Response exceeded ${MAX_RESPONSE_BYTES} bytes limit from '${currentUrl}'.`
        );
      }

      const bodyBuffer = Buffer.concat(chunks);
      body = bodyBuffer.toString('utf-8');
    } else if (typeof res.text === 'function') {
      // Mock response or non-standard — fall back to text() with size check
      const rawText = await res.text();
      if (Buffer.byteLength(rawText) > MAX_RESPONSE_BYTES) {
        throw new Error(
          `Response exceeded ${MAX_RESPONSE_BYTES} bytes limit from '${currentUrl}'.`
        );
      }
      body = rawText;
    } else {
      body = '';
    }
    const result = { status: res.status, body, headers: lastHeaders };

    // Cache successful GET responses
    if (method === 'GET' && res.status >= 200 && res.status < 300) {
      setCachedResponse(url, result.status, result.body);
    }

    return result;
  }

  throw new Error(`Exceeded max redirects (${MAX_REDIRECTS}) for '${url}'.`);
}

// ─── Cookie Jar (ported from Venera's SingleInstanceCookieJar concept) ───
// Per-plugin cookie storage: pluginId -> domain -> cookieName -> { value, expires? }
const cookieJar = new Map<string, Map<string, Map<string, { value: string; expires?: number }>>>();

function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    // Use the registrable domain (last two labels for simple cases)
    const parts = parsed.hostname.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return parsed.hostname;
  } catch {
    return '';
  }
}

function getCookiesForRequest(pluginId: string, url: string): string {
  const domain = getDomain(url);
  const pluginCookies = cookieJar.get(pluginId);
  if (!pluginCookies) return '';
  const domainCookies = pluginCookies.get(domain);
  if (!domainCookies) return '';
  const now = Date.now();
  const validCookies: string[] = [];
  for (const [name, cookie] of domainCookies) {
    if (cookie.expires && cookie.expires < now) {
      domainCookies.delete(name);
      continue;
    }
    validCookies.push(`${name}=${cookie.value}`);
  }
  return validCookies.join('; ');
}

function parseSetCookie(pluginId: string, url: string, setCookieHeader: string): void {
  if (!setCookieHeader) return;
  const domain = getDomain(url);
  if (!pluginId || !domain) return;

  if (!cookieJar.has(pluginId)) cookieJar.set(pluginId, new Map());
  const pluginCookies = cookieJar.get(pluginId)!;
  if (!pluginCookies.has(domain)) pluginCookies.set(domain, new Map());
  const domainCookies = pluginCookies.get(domain)!;

  // Parse a single Set-Cookie header value (may contain multiple cookies separated by comma)
  const cookies = setCookieHeader.split(/,(?=[^;]+?=)/);
  for (const cookieStr of cookies) {
    const parts = cookieStr.split(';').map(p => p.trim());
    const nameValue = parts[0];
    if (!nameValue || !nameValue.includes('=')) continue;
    const eqIdx = nameValue.indexOf('=');
    const name = nameValue.substring(0, eqIdx).trim();
    const value = nameValue.substring(eqIdx + 1).trim();
    if (!name) continue;

    let expires: number | undefined;
    for (const part of parts.slice(1)) {
      const lower = part.toLowerCase();
      if (lower.startsWith('max-age=')) {
        const maxAge = parseInt(lower.substring(8));
        if (!isNaN(maxAge) && maxAge > 0) {
          expires = Date.now() + maxAge * 1000;
        }
      } else if (lower.startsWith('expires=')) {
        const date = new Date(part.substring(8).trim());
        if (!isNaN(date.getTime())) {
          expires = date.getTime();
        }
      }
    }
    domainCookies.set(name, { value, expires });
  }
}

/**
 * Clear all cookies for a specific plugin (useful when a plugin is reinstalled).
 */
export function clearPluginCookies(pluginId: string): void {
  cookieJar.delete(pluginId);
}

export async function isSafeUrl(urlString: string): Promise<boolean> {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();

    // 1. Whitelist local mock endpoints (localhost:3001/mock-site/...)
    // Also allow any local loopback requests in testing environment
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      if (process.env.NODE_ENV === 'test') {
        return true;
      }
      const port = parsed.port || '80';
      if (port === '3001' && parsed.pathname.startsWith('/mock-site/')) {
        return true;
      }
      return false;
    }

    // 2. Reject private IP ranges (fast check before DNS)
    const privateIpRegex = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/;
    if (privateIpRegex.test(hostname)) {
      return false;
    }

    // 3. Block intranet domains (must have a dot)
    if (!hostname.includes('.')) {
      return false;
    }

    // 4. Resolve DNS to check if it points to a private/local IP (SSRF mitigation)
    // In test environment, skip DNS check to allow offline E2E mock server tests.
    if (process.env.NODE_ENV !== 'test') {
      try {
        const cacheKey = hostname;
        const cached = dnsCache.get(cacheKey);
        let ip: string;

        if (cached && cached.expiresAt > Date.now()) {
          ip = cached.ip;
        } else {
          const lookup = await dns.lookup(hostname);
          ip = lookup.address;
          dnsCache.set(cacheKey, {
            ip,
            expiresAt: Date.now() + DNS_CACHE_TTL_MS,
          });
        }

        if (
          privateIpRegex.test(ip) ||
          ip === '127.0.0.1' ||
          ip === '::1' ||
          ip.startsWith('fe80') ||
          ip.startsWith('fc00')
        ) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
  } catch {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }
    return false;
  }
}

interface PooledContext {
  vm: QuickJSContext;
  baseHandles: any[];
}

export class PluginSandbox {
  private pluginId: string;
  private code: string;

  // Static pool mapping pluginId -> pooled items
  private static pools = new Map<string, { code: string; items: PooledContext[] }>();

  // Static locks to prevent concurrent race condition context creations
  private static locks = new Map<string, Promise<void>>();

  constructor(pluginIdOrCode: string, code?: string) {
    if (code === undefined) {
      this.pluginId = 'temp-test-plugin-' + Math.random().toString(36).substring(2, 9);
      this.code = pluginIdOrCode;
    } else {
      this.pluginId = pluginIdOrCode;
      this.code = code;
    }
  }

  /**
   * Acquire an initialized VM context for the plugin.
   */
  private static async acquireContext(pluginId: string, code: string): Promise<PooledContext> {
    // Wait for any pending lock on this pluginId to ensure serialization
    while (this.locks.has(pluginId)) {
      await this.locks.get(pluginId);
    }

    let resolveLock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.locks.set(pluginId, lockPromise);

    try {
      let pool = this.pools.get(pluginId);
      if (pool && pool.code !== code) {
        // Clear pool if the plugin code changed
        for (const item of pool.items) {
          for (const h of item.baseHandles) {
            try {
              h.dispose();
            } catch {}
          }
          try {
            item.vm.dispose();
          } catch {}
        }
        pool = undefined;
      }

      if (!pool) {
        pool = { code, items: [] };
        this.pools.set(pluginId, pool);
      }

      if (pool.items.length > 0) {
        return pool.items.pop()!;
      }

      return await this.createContext(code);
    } finally {
      this.locks.delete(pluginId);
      resolveLock();
    }
  }

  /**
   * Return a context to the pool or dispose it if pool is full.
   */
  private static releaseContext(pluginId: string, pooled: PooledContext) {
    const pool = this.pools.get(pluginId);
    if (pool) {
      if (pool.items.length < 5) {
        pool.items.push(pooled);
        return;
      }
    }
    // Pool is full, clean up context completely
    for (const h of pooled.baseHandles) {
      try {
        h.dispose();
      } catch {}
    }
    try {
      pooled.vm.dispose();
    } catch {}
  }

  /**
   * Create a new context and load console logs, htmlParser, and eval plugin code.
   */
  private static async createContext(code: string): Promise<PooledContext> {
    const QuickJS = await getQuickJS();
    const vm = QuickJS.newContext();
    const baseHandles: any[] = [];
    const trackBase = <U extends { dispose(): void }>(handle: U): U => {
      baseHandles.push(handle);
      return handle;
    };

    // 1. Ingest console
    const logFunc = trackBase(
      vm.newFunction('log', (...logArgs) => {
        const dumped = logArgs.map((arg) => vm.dump(arg));
        console.log(`[Sandbox Plugin Log]`, ...dumped);
      })
    );
    const errFunc = trackBase(
      vm.newFunction('error', (...errArgs) => {
        const dumped = errArgs.map((arg) => vm.dump(arg));
        console.error(`[Sandbox Plugin Error]`, ...dumped);
      })
    );
    const consoleObj = trackBase(vm.newObject());
    vm.setProp(consoleObj, 'log', logFunc);
    vm.setProp(consoleObj, 'error', errFunc);
    vm.setProp(vm.global, 'console', consoleObj);

    // 2. Ingest htmlParser
    const htmlParserObj = trackBase(vm.newObject());
    const selectFunc = trackBase(
      vm.newFunction('select', (htmlVal, selectorVal) => {
        const html = vm.dump(htmlVal) as string;
        const selector = vm.dump(selectorVal) as string;
        try {
          if (selector.startsWith('/') || selector.startsWith('//')) {
            const results = executeXPath(html, selector);
            return vm.newString(JSON.stringify(results));
          }
          const cheerio = require('cheerio');
          const $ = cheerio.load(html);
          const results: any[] = [];
          $(selector).each((_: any, el: any) => {
            const $el = $(el);
            results.push({
              text: $el.text().trim(),
              html: $el.html() || '',
              attrs: el.attribs || {},
            });
          });
          return vm.newString(JSON.stringify(results));
        } catch (err: any) {
          console.error('[Sandbox htmlParser.select Error]', err);
          return vm.newString('[]');
        }
      })
    );

    const selectOneFunc = trackBase(
      vm.newFunction('selectOne', (htmlVal, selectorVal) => {
        const html = vm.dump(htmlVal) as string;
        const selector = vm.dump(selectorVal) as string;
        try {
          if (selector.startsWith('/') || selector.startsWith('//')) {
            const results = executeXPath(html, selector);
            if (results.length === 0) return vm.null;
            return vm.newString(JSON.stringify(results[0]));
          }
          const cheerio = require('cheerio');
          const $ = cheerio.load(html);
          const el = $(selector).first();
          if (el.length === 0) return vm.null;

          const result = {
            text: el.text().trim(),
            html: el.html() || '',
            attrs: el.attr() || {},
          };
          return vm.newString(JSON.stringify(result));
        } catch (err: any) {
          console.error('[Sandbox htmlParser.selectOne Error]', err);
          return vm.null;
        }
      })
    );

    const selectAttributeFunc = trackBase(
      vm.newFunction('selectAttribute', (htmlVal, selectorVal, attrVal) => {
        const html = vm.dump(htmlVal) as string;
        const selector = vm.dump(selectorVal) as string;
        const attr = vm.dump(attrVal) as string;
        try {
          if (selector.startsWith('/') || selector.startsWith('//')) {
            const results = executeXPath(html, selector);
            if (results.length === 0) return vm.newString('');
            if (selector.endsWith('/@' + attr) || selector.endsWith(`/@*[name()='${attr}']`)) {
              return vm.newString(results[0].text);
            }
            const val = results[0].attrs[attr] || '';
            return vm.newString(val);
          }
          const cheerio = require('cheerio');
          const $ = cheerio.load(html);
          const val = $(selector).attr(attr) || '';
          return vm.newString(val);
        } catch (err: any) {
          console.error('[Sandbox htmlParser.selectAttribute Error]', err);
          return vm.newString('');
        }
      })
    );

    const selectTextFunc = trackBase(
      vm.newFunction('selectText', (htmlVal, selectorVal) => {
        const html = vm.dump(htmlVal) as string;
        const selector = vm.dump(selectorVal) as string;
        try {
          if (selector.startsWith('/') || selector.startsWith('//')) {
            const results = executeXPath(html, selector);
            if (results.length === 0) return vm.newString('');
            return vm.newString(results[0].text);
          }
          const cheerio = require('cheerio');
          const $ = cheerio.load(html);
          const val = $(selector).text().trim() || '';
          return vm.newString(val);
        } catch (err: any) {
          console.error('[Sandbox htmlParser.selectText Error]', err);
          return vm.newString('');
        }
      })
    );

    vm.setProp(htmlParserObj, 'select', selectFunc);
    vm.setProp(htmlParserObj, 'selectOne', selectOneFunc);
    vm.setProp(htmlParserObj, 'selectAttribute', selectAttributeFunc);
    vm.setProp(htmlParserObj, 'selectText', selectTextFunc);
    vm.setProp(vm.global, 'htmlParser', htmlParserObj);

    // 2b. Ingest Convert (crypto API ported from Venera's JS engine)
    // All binary operations use base64-encoded strings for QuickJS bridge transport.
    const convertObj = trackBase(vm.newObject());

    const encodeUtf8Func = trackBase(vm.newFunction('encodeUtf8', (strVal) => {
      const str = vm.dump(strVal) as string;
      return vm.newString(Buffer.from(str, 'utf-8').toString('base64'));
    }));
    const decodeUtf8Func = trackBase(vm.newFunction('decodeUtf8', (b64Val) => {
      const b64 = vm.dump(b64Val) as string;
      return vm.newString(Buffer.from(b64, 'base64').toString('utf-8'));
    }));
    const encodeBase64Func = trackBase(vm.newFunction('encodeBase64', (b64Val) => {
      const b64 = vm.dump(b64Val) as string;
      // Input is already base64 (binary transport); output is the same base64
      return vm.newString(b64);
    }));
    const decodeBase64Func = trackBase(vm.newFunction('decodeBase64', (b64Val) => {
      const b64 = vm.dump(b64Val) as string;
      return vm.newString(b64); // Identity: our binary transport IS base64
    }));
    const hexEncodeFunc = trackBase(vm.newFunction('hexEncode', (b64Val) => {
      const b64 = vm.dump(b64Val) as string;
      const buf = Buffer.from(b64, 'base64');
      return vm.newString(buf.toString('hex'));
    }));
    const md5Func = trackBase(vm.newFunction('md5', (b64Val) => {
      const b64 = vm.dump(b64Val) as string;
      const buf = Buffer.from(b64, 'base64');
      return vm.newString(crypto.createHash('md5').update(buf).digest('base64'));
    }));
    const sha1Func = trackBase(vm.newFunction('sha1', (b64Val) => {
      const b64 = vm.dump(b64Val) as string;
      const buf = Buffer.from(b64, 'base64');
      return vm.newString(crypto.createHash('sha1').update(buf).digest('base64'));
    }));
    const sha256Func = trackBase(vm.newFunction('sha256', (b64Val) => {
      const b64 = vm.dump(b64Val) as string;
      const buf = Buffer.from(b64, 'base64');
      return vm.newString(crypto.createHash('sha256').update(buf).digest('base64'));
    }));
    const sha512Func = trackBase(vm.newFunction('sha512', (b64Val) => {
      const b64 = vm.dump(b64Val) as string;
      const buf = Buffer.from(b64, 'base64');
      return vm.newString(crypto.createHash('sha512').update(buf).digest('base64'));
    }));
    const hmacFunc = trackBase(vm.newFunction('hmac', (keyB64Val, dataB64Val, hashVal) => {
      const keyB64 = vm.dump(keyB64Val) as string;
      const dataB64 = vm.dump(dataB64Val) as string;
      const hash = vm.dump(hashVal) as string;
      const key = Buffer.from(keyB64, 'base64');
      const data = Buffer.from(dataB64, 'base64');
      const algo = hash.toLowerCase().replace('-', '');
      return vm.newString(crypto.createHmac(algo, key).update(data).digest('base64'));
    }));
    const hmacStringFunc = trackBase(vm.newFunction('hmacString', (keyB64Val, dataB64Val, hashVal) => {
      const keyB64 = vm.dump(keyB64Val) as string;
      const dataB64 = vm.dump(dataB64Val) as string;
      const hash = vm.dump(hashVal) as string;
      const key = Buffer.from(keyB64, 'base64');
      const data = Buffer.from(dataB64, 'base64');
      const algo = hash.toLowerCase().replace('-', '');
      return vm.newString(crypto.createHmac(algo, key).update(data).digest('hex'));
    }));

    // AES decryption (ECB, CBC, CFB, OFB) — key and iv are base64-encoded
    const decryptAesEcbFunc = trackBase(vm.newFunction('decryptAesEcb', (dataB64Val, keyB64Val) => {
      const dataB64 = vm.dump(dataB64Val) as string;
      const keyB64 = vm.dump(keyB64Val) as string;
      const data = Buffer.from(dataB64, 'base64');
      const key = Buffer.from(keyB64, 'base64');
      const decipher = crypto.createDecipheriv('aes-' + (key.length * 8) + '-ecb', key, null);
      decipher.setAutoPadding(true);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return vm.newString(decrypted.toString('base64'));
    }));
    const decryptAesCbcFunc = trackBase(vm.newFunction('decryptAesCbc', (dataB64Val, keyB64Val, ivB64Val) => {
      const dataB64 = vm.dump(dataB64Val) as string;
      const keyB64 = vm.dump(keyB64Val) as string;
      const ivB64 = vm.dump(ivB64Val) as string;
      const data = Buffer.from(dataB64, 'base64');
      const key = Buffer.from(keyB64, 'base64');
      const iv = Buffer.from(ivB64, 'base64');
      const decipher = crypto.createDecipheriv('aes-' + (key.length * 8) + '-cbc', key, iv);
      decipher.setAutoPadding(true);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return vm.newString(decrypted.toString('base64'));
    }));
    const decryptAesCfbFunc = trackBase(vm.newFunction('decryptAesCfb', (dataB64Val, keyB64Val, ivB64Val) => {
      const dataB64 = vm.dump(dataB64Val) as string;
      const keyB64 = vm.dump(keyB64Val) as string;
      const ivB64 = vm.dump(ivB64Val) as string;
      const data = Buffer.from(dataB64, 'base64');
      const key = Buffer.from(keyB64, 'base64');
      const iv = Buffer.from(ivB64, 'base64');
      const decipher = crypto.createDecipheriv('aes-' + (key.length * 8) + '-cfb', key, iv);
      decipher.setAutoPadding(false);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return vm.newString(decrypted.toString('base64'));
    }));
    const decryptAesOfbFunc = trackBase(vm.newFunction('decryptAesOfb', (dataB64Val, keyB64Val, ivB64Val) => {
      const dataB64 = vm.dump(dataB64Val) as string;
      const keyB64 = vm.dump(keyB64Val) as string;
      const ivB64 = vm.dump(ivB64Val) as string;
      const data = Buffer.from(dataB64, 'base64');
      const key = Buffer.from(keyB64, 'base64');
      const iv = Buffer.from(ivB64, 'base64');
      const decipher = crypto.createDecipheriv('aes-' + (key.length * 8) + '-ofb', key, iv);
      decipher.setAutoPadding(false);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return vm.newString(decrypted.toString('base64'));
    }));
    const decryptRsaFunc = trackBase(vm.newFunction('decryptRsa', (dataB64Val, keyB64Val) => {
      const dataB64 = vm.dump(dataB64Val) as string;
      const keyB64 = vm.dump(keyB64Val) as string;
      const data = Buffer.from(dataB64, 'base64');
      const keyPem = Buffer.from(keyB64, 'base64').toString('utf-8');
      const decrypted = crypto.privateDecrypt(keyPem, data);
      return vm.newString(decrypted.toString('base64'));
    }));

    vm.setProp(convertObj, 'encodeUtf8', encodeUtf8Func);
    vm.setProp(convertObj, 'decodeUtf8', decodeUtf8Func);
    vm.setProp(convertObj, 'encodeBase64', encodeBase64Func);
    vm.setProp(convertObj, 'decodeBase64', decodeBase64Func);
    vm.setProp(convertObj, 'hexEncode', hexEncodeFunc);
    vm.setProp(convertObj, 'md5', md5Func);
    vm.setProp(convertObj, 'sha1', sha1Func);
    vm.setProp(convertObj, 'sha256', sha256Func);
    vm.setProp(convertObj, 'sha512', sha512Func);
    vm.setProp(convertObj, 'hmac', hmacFunc);
    vm.setProp(convertObj, 'hmacString', hmacStringFunc);
    vm.setProp(convertObj, 'decryptAesEcb', decryptAesEcbFunc);
    vm.setProp(convertObj, 'decryptAesCbc', decryptAesCbcFunc);
    vm.setProp(convertObj, 'decryptAesCfb', decryptAesCfbFunc);
    vm.setProp(convertObj, 'decryptAesOfb', decryptAesOfbFunc);
    vm.setProp(convertObj, 'decryptRsa', decryptRsaFunc);
    vm.setProp(vm.global, 'Convert', convertObj);

    // 3. Evaluate the plugin code
    const evalResult = vm.evalCode(code);
    if (evalResult.error) {
      const errorDump = vm.dump(evalResult.error);
      evalResult.error.dispose();
      for (const h of baseHandles) {
        try { h.dispose(); } catch {}
      }
      vm.dispose();
      throw new Error(`Plugin initialization failed: ${errorDump?.message || errorDump}`);
    }
    if (evalResult.value) {
      evalResult.value.dispose();
    }

    return { vm, baseHandles };
  }

  /**
   * Run a method inside the sandboxed plugin environment.
   */
  async runMethod<T>(
    methodName: string,
    args: any[],
    timeoutMs: number = 5000
  ): Promise<SandboxResult<T>> {
    let pooled: PooledContext | null = null;
    const tempHandles: any[] = [];
    const trackTemp = <U extends { dispose(): void }>(handle: U): U => {
      tempHandles.push(handle);
      return handle;
    };

    // List of active deferred promises we need to resolve
    const activePromises: Promise<any>[] = [];

    try {
      pooled = await PluginSandbox.acquireContext(this.pluginId, this.code);
      const vm = pooled.vm;

      // Timeout Interrupt Handler
      const startTime = Date.now();
      vm.runtime.setInterruptHandler(() => {
        if (Date.now() - startTime > timeoutMs) {
          console.warn(
            `[Sandbox Timeout] Method ${methodName} exceeded ${timeoutMs}ms and was terminated.`
          );
          return true; // Interrupts execution
        }
        return false;
      });
      // 1. Ingest sandboxed fetch API (hardened: timeout, redirect validation, size limit, retry, cache)
      const fetchFunc = trackTemp(
        vm.newFunction('fetch', (urlVal, optionsVal) => {
          const url = vm.dump(urlVal) as string;
          const options = optionsVal ? vm.dump(optionsVal) : {};
          const deferred = trackTemp(vm.newPromise());

          const promise = (async () => {
            try {
              const result = await hardenedFetch(url, options, this.pluginId);

              // Construct simulated fetch response object in QuickJS
              const resObj = trackTemp(vm.newObject());

              const statusHandle = trackTemp(vm.newNumber(result.status));
              vm.setProp(resObj, 'status', statusHandle);

              const textFunc = trackTemp(
                vm.newFunction('text', () => {
                  return vm.newString(result.body);
                })
              );
              const jsonFunc = trackTemp(
                vm.newFunction('json', () => {
                  try {
                    return vm.newString(JSON.stringify(JSON.parse(result.body)));
                  } catch {
                    return vm.newString('{}');
                  }
                })
              );

              vm.setProp(resObj, 'text', textFunc);
              vm.setProp(resObj, 'json', jsonFunc);

              deferred.resolve(resObj);
            } catch (err: any) {
              const errStr = trackTemp(vm.newString(err.message || String(err)));
              deferred.reject(errStr);
            }
          })();

          activePromises.push(promise);
          return deferred.handle;
        })
      );

      vm.setProp(vm.global, 'fetch', fetchFunc);

      // 2. Ingest sandboxed sniffVideo API
      const sniffVideoFunc = trackTemp(
        vm.newFunction('sniffVideo', (urlVal, headersVal) => {
          const url = vm.dump(urlVal) as string;
          const headers = headersVal ? vm.dump(headersVal) : {};
          const deferred = trackTemp(vm.newPromise());

          const promise = (async () => {
            try {
              const isSafe = await isSafeUrl(url);
              if (!isSafe) {
                const errStr = trackTemp(
                  vm.newString(
                    `SecurityError: sniffVideo URL '${url}' is blocked by sandbox policy.`
                  )
                );
                deferred.reject(errStr);
                return;
              }
              const sniffedUrl = await PlaywrightSniffer.sniff(url, headers);
              const sniffedUrlVal = trackTemp(vm.newString(sniffedUrl || ''));
              deferred.resolve(sniffedUrlVal);
            } catch (err: any) {
              const errVal = trackTemp(vm.newString(err.message || String(err)));
              deferred.reject(errVal);
            }
          })();

          activePromises.push(promise);
          return deferred.handle;
        })
      );
      vm.setProp(vm.global, 'sniffVideo', sniffVideoFunc);

      // 2b. Ingest atob for Base64 decoding (needed by MacPlayer encrypt:2 fallback)
      const atobFunc = trackTemp(
        vm.newFunction('atob', (strVal) => {
          const str = vm.dump(strVal) as string;
          try {
            const decoded = Buffer.from(str, 'base64').toString('utf-8');
            return trackTemp(vm.newString(decoded));
          } catch {
            return trackTemp(vm.newString(''));
          }
        })
      );
      vm.setProp(vm.global, 'atob', atobFunc);

      // 3. Invoke the method on the global plugin object (e.g. `plugin.search("query")`)
      const serializedArgs = JSON.stringify(args);
      const executionExpr = `
        (async () => {
          if (typeof plugin === 'undefined') {
            throw new Error("Global 'plugin' object is not defined.");
          }
          if (typeof plugin.${methodName} !== 'function') {
            throw new Error("Method '${methodName}' is not defined on the plugin.");
          }
          const rawResult = await plugin.${methodName}(...${serializedArgs});
          return rawResult;
        })()
      `;

      const execResult = vm.evalCode(executionExpr);
      if (execResult.error) {
        const errorDump = vm.dump(execResult.error);
        execResult.error.dispose();
        return {
          success: false,
          error: `Execution preparation failed: ${errorDump?.message || errorDump}`,
        };
      }

      // Track the execution result handle
      trackTemp(execResult.value);

      // 4. Handle Promise resolution using an active event loop driver
      // Since it is wrapped in an async IIFE, the returned value is always a promise handle
      const resolvedPromise = vm.resolvePromise(execResult.value);

      // Advanced event loop driver for nested async tasks
      let hasPending = true;
      while (hasPending) {
        vm.runtime.executePendingJobs();

        if (activePromises.length > 0) {
          const batch = [...activePromises];
          activePromises.length = 0;
          await Promise.allSettled(batch);
          continue;
        }

        hasPending = vm.runtime.hasPendingJob();
        if (hasPending) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const resolvedResult = await resolvedPromise;

      if (resolvedResult.error) {
        const errorDump = vm.dump(resolvedResult.error);
        trackTemp(resolvedResult.error);
        return {
          success: false,
          error: `Sandbox execution rejected: ${errorDump?.message || errorDump}`,
        };
      }

      trackTemp(resolvedResult.value);
      const data = vm.dump(resolvedResult.value);

      // Only auto-parse JSON containers; plain-text results (e.g. novel content
      // that happens to be "42" or "true") must stay strings
      let finalData = data;
      if (typeof data === 'string') {
        const trimmed = data.trimStart();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          try {
            finalData = JSON.parse(data);
          } catch {}
        }
      }

      return {
        success: true,
        data: finalData as T,
      };
    } catch (e: any) {
      return {
        success: false,
        error: e.message || String(e),
      };
    } finally {
      // Ensure all outstanding host fetch promises are settled before disposing the context
      if (activePromises.length > 0) {
        await Promise.allSettled(activePromises);
      }

      // Dispose of all temporary handles safely
      for (const h of tempHandles) {
        try {
          if (h && typeof h.dispose === 'function') {
            const isAlive = 'alive' in h ? h.alive : true;
            if (isAlive) {
              h.dispose();
            }
          }
        } catch (err) {
          // Guard against any double-free errors from the library
        }
      }

      if (pooled) {
        const vm = pooled.vm;
        vm.setProp(vm.global, 'fetch', vm.undefined);
        vm.setProp(vm.global, 'sniffVideo', vm.undefined);
        vm.runtime.setInterruptHandler(undefined as any);

        // Return the context to the pool
        PluginSandbox.releaseContext(this.pluginId, pooled);
      }
    }
  }
}
