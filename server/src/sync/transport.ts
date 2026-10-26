import { DOMParser } from '@xmldom/xmldom';
import { MAX_SNAPSHOT_BYTES } from './protocol';

export interface WebDavConfig { url: string; username: string; password: string; allowInsecureHttp?: boolean }
export const REQUEST_TIMEOUT_MS = 15000;
export const MAX_DIRECTORY_ENTRIES = 10000;
export class DavError extends Error {
  constructor(public status: number, method: string) { super(`WebDAV ${method}: HTTP ${status}`); }
}
export class WebDavTransport {
  readonly root: URL;
  private authorization: string;
  constructor(config: WebDavConfig) {
    if (!config || typeof config.url !== 'string' || typeof config.username !== 'string' || typeof config.password !== 'string') throw new Error('Invalid WebDAV configuration');
    let root: URL;
    try { root = new URL(config.url); } catch { throw new Error('Invalid WebDAV URL'); }
    if (root.username || root.password || root.search || root.hash) throw new Error('WebDAV URL must not contain credentials, query or fragment');
    if (root.protocol !== 'https:' && !(root.protocol === 'http:' && config.allowInsecureHttp === true)) throw new Error('WebDAV requires HTTPS');
    if (!root.pathname.endsWith('/')) root.pathname += '/';
    this.root = root;
    this.authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
  }
  resolve(path: string): URL {
    const url = new URL(path, this.root);
    if (url.origin !== this.root.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(this.root.pathname)) throw new Error('WebDAV path outside configured root');
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\\') || decoded.split('/').some(p => p === '..' || p === '.')) throw new Error('Invalid WebDAV path');
    return url;
  }
  async request(method: string, path: string, body?: string, headers: Record<string, string> = {}, allow404 = false): Promise<{ status: number; bytes: string }> {
    if (body !== undefined && Buffer.byteLength(body) > MAX_SNAPSHOT_BYTES) throw new Error('WebDAV request too large');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.resolve(path), { method, body, headers: { Authorization: this.authorization, ...headers }, redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) throw new Error('WebDAV redirects are not allowed');
      if (!response.ok && !(allow404 && response.status === 404)) throw new DavError(response.status, method);
      const size = Number(response.headers.get('content-length'));
      if (size > MAX_SNAPSHOT_BYTES) throw new Error('WebDAV response too large');
      const reader = response.body?.getReader();
      let total = 0;
      const chunks: Uint8Array[] = [];
      if (reader) for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > MAX_SNAPSHOT_BYTES) { await reader.cancel(); throw new Error('WebDAV response too large'); }
        chunks.push(chunk.value);
      }
      return { status: response.status, bytes: Buffer.concat(chunks).toString('utf8') };
    } catch (error) {
      if (controller.signal.aborted) throw new Error('WebDAV request timed out');
      if (error instanceof DavError) throw error;
      if (error instanceof Error && /^WebDAV |^Invalid WebDAV/.test(error.message)) throw error;
      throw new Error('WebDAV network or response error');
    } finally { clearTimeout(timeout); }
  }
  async mkdir(path: string): Promise<void> {
    try { await this.request('MKCOL', path); }
    catch (error) {
      if (!(error instanceof DavError) || error.status !== 405) throw error;
      await this.list(path);
    }
  }
  async list(path: string): Promise<{ path: string; collection: boolean }[]> {
    const response = await this.request('PROPFIND', path, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>', { Depth: '1', 'Content-Type': 'application/xml' });
    if (response.status !== 207 || /<!DOCTYPE|<!ENTITY/i.test(response.bytes)) throw new Error('WebDAV invalid directory XML');
    const document = new DOMParser({ onError: () => { throw new Error('WebDAV invalid directory XML'); } }).parseFromString(response.bytes, 'application/xml');
    if (document.documentElement?.namespaceURI !== 'DAV:' || document.documentElement.localName !== 'multistatus') throw new Error('WebDAV invalid directory XML');
    const nodes = document.getElementsByTagNameNS('DAV:', 'response');
    if (nodes.length > MAX_DIRECTORY_ENTRIES) throw new Error('WebDAV directory too large');
    const parent = this.resolve(path);
    const result = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes.item(i)!;
      const href = node.getElementsByTagNameNS('DAV:', 'href').item(0)?.textContent;
      if (!href) throw new Error('WebDAV missing directory href');
      const url = this.resolve(new URL(href, parent).href);
      if (url.pathname === parent.pathname) continue;
      const tail = url.pathname.slice(parent.pathname.length).replace(/\/$/, '');
      if (!url.pathname.startsWith(parent.pathname) || !tail || tail.includes('/')) throw new Error('WebDAV invalid directory href');
      const statuses = node.getElementsByTagNameNS('DAV:', 'status');
      if (!statuses.length || !Array.from(statuses).some(s => /\s200\s/.test(s.textContent || ''))) throw new Error('WebDAV failed directory entry');
      result.push({ path: url.href, collection: node.getElementsByTagNameNS('DAV:', 'collection').length > 0 });
    }
    return result;
  }
}
