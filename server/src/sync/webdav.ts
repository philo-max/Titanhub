import crypto from 'node:crypto';
import type { SqliteStorage } from '../db/sqlite/storage';
import { mergeRecords, parseSnapshot, type SyncRecord } from './protocol';
import { completePublication, getPending, getSyncState, preparePublication, type PendingPublication } from './storage';
import { DavError, WebDavTransport, type WebDavConfig } from './transport';
export type { WebDavConfig } from './transport';

const DEVICES = 'Titanhub/sync/v1/devices/';
let running = false;
async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (running) throw new Error('WebDAV task already running');
  running = true;
  try { return await action(); } finally { running = false; }
}
function generation(path: string): number | null {
  const name = new URL(path).pathname.split('/').pop()!;
  if (!name.endsWith('.json')) return null;
  if (!/^\d{20}\.json$/.test(name)) throw new Error('Invalid WebDAV generation filename');
  const value = Number(name.slice(0, 20));
  if (!Number.isSafeInteger(value)) throw new Error('Invalid WebDAV generation');
  return value;
}
async function ensureDirectories(dav: WebDavTransport): Promise<void> {
  for (const directory of ['Titanhub/', 'Titanhub/sync/', 'Titanhub/sync/v1/', DEVICES]) await dav.mkdir(directory);
}
async function readRemote(dav: WebDavTransport): Promise<SyncRecord[]> {
  let records: SyncRecord[] = [];
  for (const entry of await dav.list(DEVICES)) {
    if (!entry.collection) continue;
    const deviceId = decodeURIComponent(new URL(entry.path).pathname.split('/').filter(Boolean).pop()!);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(deviceId)) throw new Error('Invalid WebDAV device directory');
    let snapshot;
    for (let attempt = 0; attempt < 2; attempt++) {
      const entries = (await dav.list(entry.path)).filter(e => !e.collection).map(e => ({ ...e, generation: generation(e.path) })).filter(e => e.generation !== null).sort((a, b) => b.generation! - a.generation!);
      if (!entries.length) {
        if (attempt > 0) throw new Error('WebDAV generation disappeared');
        break;
      }
      const highest = entries[0];
      const response = await dav.request('GET', highest.path, undefined, {}, true);
      if (response.status === 404 && attempt === 0) continue;
      if (response.status === 404) throw new Error('WebDAV generation disappeared');
      snapshot = parseSnapshot(response.bytes);
      if (snapshot.deviceId !== deviceId || snapshot.generation !== highest.generation) throw new Error('WebDAV snapshot identity mismatch');
      break;
    }
    if (snapshot) records = mergeRecords(records, snapshot.records);
  }
  return records;
}
async function verifyFinal(dav: WebDavTransport, final: string, bytes: string): Promise<boolean> {
  const response = await dav.request('GET', final, undefined, {}, true);
  if (response.status === 404) return false;
  if (response.bytes !== bytes) throw new Error('WebDAV immutable generation conflict');
  return true;
}
async function publish(dav: WebDavTransport, directory: string, pending: PendingPublication): Promise<void> {
  const name = pending.generation.toString().padStart(20, '0');
  const final = `${directory}${name}.json`;
  const tmp = `${directory}${name}.${crypto.createHash('sha256').update(pending.bytes).digest('hex')}.tmp`;
  await dav.mkdir(directory);
  if (await verifyFinal(dav, final, pending.bytes)) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const old = await dav.request('GET', tmp, undefined, {}, true);
      if (old.status !== 404 && old.bytes !== pending.bytes) throw new Error('WebDAV temporary publication conflict');
      if (old.status === 404) await dav.request('PUT', tmp, pending.bytes, { 'Content-Type': 'application/json', 'If-None-Match': '*' });
      await dav.request('MOVE', tmp, undefined, { Destination: dav.resolve(final).href, Overwrite: 'F' });
      if (!await verifyFinal(dav, final, pending.bytes)) throw new Error('WebDAV publication missing after MOVE');
      return;
    } catch (error) {
      if (await verifyFinal(dav, final, pending.bytes)) return;
      if (error instanceof DavError || attempt === 1 || !(error instanceof Error) || !/timed out|network/.test(error.message)) throw error;
    }
  }
}
async function cleanup(dav: WebDavTransport, directory: string): Promise<string[]> {
  try {
    const entries = (await dav.list(directory)).filter(e => !e.collection);
    const committed = entries.map(e => ({ ...e, generation: generation(e.path) })).filter(e => e.generation !== null).sort((a, b) => b.generation! - a.generation!);
    const remove = [...committed.slice(2), ...entries.filter(e => e.path.endsWith('.tmp'))];
    for (const entry of remove) await dav.request('DELETE', entry.path);
    return [];
  } catch { return ['WebDAV cleanup failed; older files were retained.']; }
}
export async function testWebDavConnection(config: WebDavConfig): Promise<{ success: true; warnings: string[] }> {
  return exclusive(async () => {
    const dav = new WebDavTransport(config);
    await dav.list(dav.root.href);
    const directory = `Titanhub-test-${crypto.randomUUID()}/`;
    const bytes = crypto.randomBytes(32).toString('hex');
    const warnings: string[] = [];
    try {
      await dav.mkdir(directory);
      await dav.list(directory);
      await dav.request('PUT', `${directory}probe.tmp`, bytes);
      if ((await dav.request('GET', `${directory}probe.tmp`)).bytes !== bytes) throw new Error('WebDAV test read mismatch');
      await dav.request('MOVE', `${directory}probe.tmp`, undefined, { Destination: dav.resolve(`${directory}probe.json`).href, Overwrite: 'F' });
      if (!await verifyFinal(dav, `${directory}probe.json`, bytes)) throw new Error('WebDAV test MOVE verification failed');
    } finally {
      for (const file of [`${directory}probe.tmp`, `${directory}probe.json`, directory]) {
        try { await dav.request('DELETE', file, undefined, {}, true); } catch { warnings.push('WebDAV test resource cleanup failed.'); }
      }
    }
    return { success: true, warnings };
  });
}
export async function syncWebDav(storage: SqliteStorage, config: WebDavConfig): Promise<{ lastSuccessAt: string | null; pendingChanges: boolean; warnings: string[] }> {
  return exclusive(async () => {
    const dav = new WebDavTransport(config);
    await ensureDirectories(dav);
    const records = await readRemote(dav);
    const directory = `${DEVICES}${getSyncState(storage).device_id}/`;
    const previous = getPending(storage);
    if (previous) {
      await publish(dav, directory, previous);
      completePublication(storage, previous);
    }
    const pending = preparePublication(storage, records);
    await publish(dav, directory, pending);
    completePublication(storage, pending);
    const warnings = await cleanup(dav, directory);
    const state = getSyncState(storage);
    return { lastSuccessAt: state.last_success_at, pendingChanges: state.counter > state.published_counter, warnings };
  });
}
