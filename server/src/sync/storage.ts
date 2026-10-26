import crypto from 'node:crypto';
import type { SqliteStorage } from '../db/sqlite/storage';
import { mediaKey, mergeRecords, normalizeRecord, parseSnapshot, type SyncRecord } from './protocol';

export interface SyncState {
  device_id: string; counter: number; generation: number; imported: number;
  published_counter: number; last_success_at: string | null;
}
export interface PendingPublication { generation: number; counter: number; bytes: string }
export function getSyncState(db: SqliteStorage): SyncState {
  db.run('INSERT OR IGNORE INTO sync_device (id, device_id) VALUES (1, ?)', [crypto.randomUUID()]);
  return db.queryOne<SyncState>('SELECT * FROM sync_device WHERE id = 1')!;
}
export function readRecords(db: SqliteStorage): SyncRecord[] {
  return db.query<{ record: string }>('SELECT record FROM sync_records ORDER BY kind, media_key').map(r => normalizeRecord(JSON.parse(r.record)));
}
function saveRecord(db: SqliteStorage, record: SyncRecord): void {
  db.run('INSERT OR REPLACE INTO sync_records (kind, media_key, record) VALUES (?, ?, ?)', [record.kind, record.key, JSON.stringify(record)]);
}
function applyRecord(db: SqliteStorage, r: SyncRecord): void {
  const key = ['local', r.mediaType, r.pluginId, r.mediaId];
  if (r.kind === 'favorite') {
    if (r.isDeleted) db.run('DELETE FROM favorites WHERE user_id = ? AND media_type = ? AND plugin_id = ? AND media_id = ?', key);
    else db.run(`INSERT INTO favorites (id,user_id,media_type,plugin_id,media_id,created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id,media_type,plugin_id,media_id) DO UPDATE SET created_at=excluded.created_at`, [crypto.randomUUID(), ...key, r.updatedAt]);
  } else db.run(`INSERT INTO tracking (id,user_id,media_type,plugin_id,media_id,chapter_id,chapter_no,progress,position,status,updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id,media_type,plugin_id,media_id) DO UPDATE SET
    chapter_id=excluded.chapter_id, chapter_no=excluded.chapter_no, progress=excluded.progress, position=excluded.position,
    status=excluded.status, updated_at=excluded.updated_at`, [crypto.randomUUID(), ...key, r.chapterId!, r.chapterNo!, r.progress!, r.position!, r.status!, r.updatedAt]);
}
export function writeLocalRecord(db: SqliteStorage, value: Omit<SyncRecord, 'version' | 'key'>): void {
  const state = getSyncState(db);
  if (state.counter >= Number.MAX_SAFE_INTEGER) throw new Error('Sync counter exhausted');
  const record = normalizeRecord({ ...value, key: mediaKey(value), version: { counter: state.counter + 1, deviceId: state.device_id } });
  applyRecord(db, record);
  saveRecord(db, record);
  db.run('UPDATE sync_device SET counter = ? WHERE id = 1', [record.version.counter]);
}
export function importLegacy(db: SqliteStorage): void {
  if (getSyncState(db).imported) return;
  const existing = new Set(readRecords(db).map(r => JSON.stringify([r.kind, r.key])));
  for (const kind of ['favorite', 'progress'] as const) {
    const table = kind === 'favorite' ? 'favorites' : 'tracking';
    const rows = db.query<{ media_type: string; plugin_id: string; media_id: string; created_at: string; updated_at: string;
      chapter_id: string | null; chapter_no: number; progress: number; position: number | null; status: string }>(`SELECT * FROM ${table} WHERE user_id = 'local'`);
    for (const row of rows) {
      const base = { kind, mediaType: row.media_type, pluginId: row.plugin_id, mediaId: row.media_id, updatedAt: row.updated_at || row.created_at };
      if (existing.has(JSON.stringify([kind, mediaKey(base)]))) continue;
      writeLocalRecord(db, kind === 'favorite' ? { ...base, isDeleted: false } : { ...base, chapterId: row.chapter_id || '',
        chapterNo: row.chapter_no, progress: row.progress, position: row.position ?? null, status: row.status });
    }
  }
  db.run('UPDATE sync_device SET imported = 1 WHERE id = 1');
}
export function getPending(db: SqliteStorage): PendingPublication | null {
  return db.queryOne<PendingPublication>('SELECT generation, counter, bytes FROM sync_pending WHERE id = 1');
}
export function preparePublication(db: SqliteStorage, remote: SyncRecord[]): PendingPublication {
  return db.transaction(() => {
    importLegacy(db);
    const state = getSyncState(db);
    const records = mergeRecords(readRecords(db), remote);
    let counter = state.counter;
    for (const r of records) { counter = Math.max(counter, r.version.counter); saveRecord(db, r); applyRecord(db, r); }
    if (state.generation >= Number.MAX_SAFE_INTEGER) throw new Error('Sync generation exhausted');
    const generation = state.generation + 1;
    const bytes = JSON.stringify({ schemaVersion: 1, deviceId: state.device_id, generation, records });
    parseSnapshot(bytes);
    db.run('UPDATE sync_device SET counter = ?, generation = ? WHERE id = 1', [counter, generation]);
    db.run('INSERT INTO sync_pending (id, generation, counter, bytes) VALUES (1, ?, ?, ?)', [generation, counter, bytes]);
    return { generation, counter, bytes };
  });
}
export function completePublication(db: SqliteStorage, pending: PendingPublication): void {
  db.transaction(() => {
    const saved = getPending(db);
    if (!saved || saved.bytes !== pending.bytes) throw new Error('Publication mismatch');
    db.run('UPDATE sync_device SET published_counter = ?, last_success_at = ? WHERE id = 1', [pending.counter, new Date().toISOString()]);
    db.run('DELETE FROM sync_pending WHERE id = 1');
  });
}
