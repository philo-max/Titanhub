import { describe, expect, it, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStorage, runMigrations, sqliteMergeFavorites } from '../db/sqlite';
import { readRecords } from './storage';
import { syncWebDav, testWebDavConnection } from './webdav';

const servers: http.Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function fixture() {
  const files = new Map<string, string>();
  const dirs = new Set(['/']);
  let denied = false, move = true, puts = 0, failMove = false, delayMove = false;
  let forbidden = 0, get404 = false;
  let directoryXml: string | null = null;
  let onPut: (() => void) | undefined;
  const server = http.createServer(async (req, res) => {
    if (denied) { res.writeHead(401).end(); return; }
    if (forbidden) { res.writeHead(forbidden).end(); return; }
    const pathname = new URL(req.url!, 'http://fixture').pathname;
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks).toString();
    if (req.method === 'MKCOL') { const exists = dirs.has(pathname); dirs.add(pathname); res.writeHead(exists ? 405 : 201).end(); }
    else if (req.method === 'PROPFIND') {
      if (directoryXml !== null) { res.writeHead(207).end(directoryXml); return; }
      if (!dirs.has(pathname)) { res.writeHead(404).end(); return; }
      const children = [...dirs, ...files.keys()].filter(p => p === pathname || (p.startsWith(pathname) && !p.slice(pathname.length).replace(/\/$/, '').includes('/')));
      res.writeHead(207, { 'Content-Type': 'application/xml' }).end(`<d:multistatus xmlns:d="DAV:">${children.map(p => `<d:response><d:href>${p}</d:href><d:propstat><d:prop><d:resourcetype>${dirs.has(p) ? '<d:collection/>' : ''}</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')}</d:multistatus>`);
    } else if (req.method === 'PUT') { puts++; files.set(pathname, bytes); onPut?.(); res.writeHead(201).end(); }
    else if (req.method === 'GET') {
      if (get404 && pathname.endsWith('.json')) { get404 = false; res.writeHead(404).end(); return; }
      res.writeHead(files.has(pathname) ? 200 : 404).end(files.get(pathname));
    }
    else if (req.method === 'MOVE') {
      if (!move) { res.writeHead(405).end(); return; }
      if (failMove) { res.writeHead(507).end(); return; }
      const destination = new URL(req.headers.destination as string).pathname;
      if (files.has(destination)) { res.writeHead(412).end(); return; }
      files.set(destination, files.get(pathname)!); files.delete(pathname);
      if (!delayMove) res.writeHead(201).end();
    } else if (req.method === 'DELETE') { files.delete(pathname); dirs.delete(pathname); res.writeHead(204).end(); }
    else res.writeHead(405).end();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { config: { url: `http://127.0.0.1:${address.port}/`, username: 'user', password: 'secret', allowInsecureHttp: true }, files,
    get puts() { return puts; }, deny() { denied = true; }, disableMove() { move = false; },
    setMoveFailure(value: boolean) { failMove = value; }, delayMove() { delayMove = true; },
    onPut(action: () => void) { onPut = action; },
    get404Once() { get404 = true; },
    forbid(status: number) { forbidden = status; }, xml(value: string) { directoryXml = value; } };
}
async function database() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-dav-'));
  const db = await SqliteStorage.open({ dbPath: path.join(dir, 'db') }); runMigrations(db); return db;
}
describe('WebDAV transport and synchronization', () => {
  it('keeps edits during upload dirty and rejects overlapping synchronization', async () => {
    const f = await fixture(), db = await database();
    const item = { mediaType: 'anime', pluginId: 'p', mediaId: 'concurrent' };
    let parallel: Promise<void> | undefined;
    f.onPut(() => {
      sqliteMergeFavorites(db, 'local', [item]);
      parallel = expect(syncWebDav(db, f.config)).rejects.toThrow('already running');
    });
    const result = await syncWebDav(db, f.config);
    await parallel;
    expect(result.pendingChanges).toBe(true);
    f.onPut(() => {});
    expect((await syncWebDav(db, f.config)).pendingChanges).toBe(false);
    db.close();
  });
  it('recovers the exact pending publication and merges edits made during failure', async () => {
    const f = await fixture(), db = await database(), remote = await database();
    const item = { mediaType: 'manga', pluginId: 'p', mediaId: 'a' };
    sqliteMergeFavorites(db, 'local', [item]);
    f.setMoveFailure(true);
    await expect(syncWebDav(db, f.config)).rejects.toThrow('507');
    const pendingBytes = [...f.files.values()][0];
    sqliteMergeFavorites(db, 'local', [{ ...item, isDeleted: true }]);
    f.setMoveFailure(false);
    sqliteMergeFavorites(remote, 'local', [{ ...item, mediaId: 'remote' }]);
    await syncWebDav(remote, f.config);
    await syncWebDav(db, f.config);
    expect([...f.files.values()]).toContain(pendingBytes);
    expect(readRecords(db).some(r => r.mediaId === 'remote')).toBe(true);
    await syncWebDav(remote, f.config);
    expect(readRecords(db)).toEqual(readRecords(remote));
    db.close(); remote.close();
  });
  it('checks the final immutable file after a timed out MOVE', async () => {
    const f = await fixture(), db = await database(); f.delayMove();
    const result = await syncWebDav(db, f.config);
    expect(result.lastSuccessAt).toBeTruthy();
    expect(f.puts).toBe(1); db.close();
  }, 25000);
  it('rejects external XML entities and out of root directory hrefs', async () => {
    const f = await fixture();
    f.xml('<!DOCTYPE d [<!ENTITY x SYSTEM "file:///secret">]><d:multistatus xmlns:d="DAV:"/>');
    await expect(testWebDavConnection(f.config)).rejects.toThrow('XML');
    f.xml('<d:multistatus xmlns:d="DAV:"><d:response><d:href>http://other.invalid/</d:href></d:response></d:multistatus>');
    await expect(testWebDavConnection(f.config)).rejects.toThrow('root');
  });
  it('tests real resource capabilities and converges two independent offline databases', async () => {
    const f = await fixture();
    expect((await testWebDavConnection(f.config)).success).toBe(true);
    const a = await database(), b = await database();
    const item = { mediaType: 'anime', pluginId: 'p', mediaId: 'm' };
    sqliteMergeFavorites(a, 'local', [item]);
    sqliteMergeFavorites(b, 'local', [{ ...item, isDeleted: true }]);
    await syncWebDav(a, f.config); await syncWebDav(b, f.config); await syncWebDav(a, f.config);
    expect(readRecords(a)).toEqual(readRecords(b));
    expect([...f.files.keys()].some(p => /\d{20}\.json$/.test(p))).toBe(true);
    a.close(); b.close();
  });
  it.each(['{bad', '{"schemaVersion":2}'])('stops before writing or uploading for a corrupt highest generation: %s', async (bytes) => {
    const f = await fixture(), db = await database();
    await syncWebDav(db, f.config);
    const file = [...f.files.keys()].find(p => p.endsWith('.json'))!;
    f.files.set(file, bytes);
    const count = f.puts;
    const before = db.query('SELECT * FROM sync_device');
    await expect(syncWebDav(db, f.config)).rejects.toThrow();
    expect(f.puts).toBe(count);
    expect(db.query('SELECT * FROM sync_device')).toEqual(before); db.close();
  });
  it('re-lists once after a disappearing GET and imports remote data into an empty device', async () => {
    const f = await fixture(), a = await database(), b = await database();
    sqliteMergeFavorites(a, 'local', [{ mediaType: 'novel', pluginId: 'p', mediaId: 'm' }]);
    await syncWebDav(a, f.config);
    f.get404Once();
    await syncWebDav(b, f.config);
    expect(readRecords(b)).toEqual(readRecords(a));
    a.close(); b.close();
  });
  it('reports authentication and incompatible MOVE without leaking secrets', async () => {
    const f = await fixture(); f.deny();
    await expect(testWebDavConnection(f.config)).rejects.toThrow('401');
    const g = await fixture(); g.disableMove();
    await expect(testWebDavConnection(g.config)).rejects.toThrow('405');
    await expect(testWebDavConnection({ ...g.config, allowInsecureHttp: false })).rejects.toThrow('HTTPS');
    const h = await fixture(); h.forbid(403);
    await expect(testWebDavConnection(h.config)).rejects.toThrow('403');
  });
});
