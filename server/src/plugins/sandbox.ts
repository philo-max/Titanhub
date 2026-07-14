import { getQuickJS, QuickJSContext } from 'quickjs-emscripten';
import { PlaywrightSniffer } from './sniffer';
import dns from 'dns/promises';

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
      // 1. Ingest sandboxed fetch API
      const fetchFunc = trackTemp(
        vm.newFunction('fetch', (urlVal, optionsVal) => {
          const url = vm.dump(urlVal) as string;
          const options = optionsVal ? vm.dump(optionsVal) : {};
          const deferred = trackTemp(vm.newPromise());

          const promise = (async () => {
            try {
              const isSafe = await isSafeUrl(url);
              if (!isSafe) {
                const errStr = trackTemp(
                  vm.newString(
                    `SecurityError: Access to URL '${url}' is blocked by sandbox policy.`
                  )
                );
                deferred.reject(errStr);
                return;
              }

              // Apply domain-specific rate limiting
              try {
                const parsedUrl = new URL(url);
                const hostname = parsedUrl.hostname.toLowerCase();
                const minInterval = DOMAIN_MIN_INTERVAL[hostname] || 0;
                if (minInterval > 0) {
                  const lastTime = domainLastRequestTime.get(hostname) || 0;
                  const now = Date.now();
                  const targetTime = Math.max(now, lastTime + minInterval);
                  domainLastRequestTime.set(hostname, targetTime);
                  const delay = targetTime - now;
                  if (delay > 0) {
                    await new Promise((resolve) => setTimeout(resolve, delay));
                  }
                }
              } catch {}

              const res = await fetch(url, options);
              const text = await res.text();

              // Construct simulated fetch response object in QuickJS
              const resObj = trackTemp(vm.newObject());

              const statusHandle = trackTemp(vm.newNumber(res.status));
              vm.setProp(resObj, 'status', statusHandle);

              const textFunc = trackTemp(
                vm.newFunction('text', () => {
                  return vm.newString(text);
                })
              );
              const jsonFunc = trackTemp(
                vm.newFunction('json', () => {
                  try {
                    return vm.newString(JSON.stringify(JSON.parse(text)));
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
