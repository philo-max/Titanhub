import { getSqliteStorage } from '../db/sqlite';
import { syncWebDav, testWebDavConnection, type WebDavConfig } from './webdav';

export function createWebDavMessageHandler(send: (response: unknown) => void): (message: unknown) => Promise<void> {
  return async (message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const request = message as { type?: unknown; id?: unknown; config?: unknown };
    if (request.type !== 'webdav:test' && request.type !== 'webdav:sync') return;
    if (typeof request.id !== 'string' || !request.id || request.id.length > 128) return;
    const result = { type: 'webdav:result', id: request.id };
    try {
      if (!request.config || typeof request.config !== 'object') throw new Error('Invalid WebDAV configuration');
      const value = request.config as WebDavConfig;
      if (typeof value.url !== 'string' || value.url.length > 8192 || typeof value.username !== 'string' || value.username.length > 8192 || typeof value.password !== 'string' || value.password.length > 8192) throw new Error('Invalid WebDAV configuration');
      const config: WebDavConfig = { url: value.url, username: value.username, password: value.password, allowInsecureHttp: value.allowInsecureHttp === true };
      const data = request.type === 'webdav:test' ? await testWebDavConnection(config) : await syncWebDav(await getSqliteStorage(), config);
      send({ ...result, success: true, data });
    } catch (error) {
      const message = error instanceof Error && /^(WebDAV |Invalid WebDAV |Invalid snapshot|Invalid record|Invalid media|Invalid number|Invalid integer|Invalid string|Invalid tombstone|Invalid generation|Conflicting equal|Snapshot too|Too many|Sync counter|Sync generation)/.test(error.message) ? error.message : 'WebDAV synchronization failed';
      send({ ...result, success: false, error: message });
    }
  };
}
