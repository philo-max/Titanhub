import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStorage, runMigrations, sqliteMergeFavorites, sqliteMergeTracking } from '../db/sqlite';
import { getSyncState, readRecords, preparePublication, completePublication } from './storage';

describe('sync persistence', () => {
  it('imports old local data once and never resurrects a tombstone from stale business data', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-sync-legacy-'));
    const db = await SqliteStorage.open({ dbPath: path.join(dir, 'db') }); runMigrations(db);
    db.run("INSERT INTO favorites VALUES ('old','local','anime','m','p','2025-01-01')");
    const first = preparePublication(db, []); completePublication(db, first);
    expect(readRecords(db)).toHaveLength(1);
    sqliteMergeFavorites(db, 'local', [{ mediaType: 'anime', mediaId: 'm', pluginId: 'p', isDeleted: true }]);
    db.run("INSERT INTO favorites VALUES ('stale','local','anime','m','p','2025-01-01')");
    const second = preparePublication(db, []); completePublication(db, second);
    expect(readRecords(db)[0].isDeleted).toBe(true);
    expect(db.query('SELECT * FROM favorites')).toHaveLength(0);
    db.close();
  });
  it('applies remote versions without local reversioning and rejects overflow atomically', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-sync-counter-'));
    const db = await SqliteStorage.open({ dbPath: path.join(dir, 'db') }); runMigrations(db);
    const item = { mediaType: 'anime', mediaId: 'm', pluginId: 'p' };
    const remote = { ...item, kind: 'favorite' as const, key: '["anime","p","m"]', isDeleted: false,
      updatedAt: '2025-01-01', version: { counter: 100, deviceId: 'remote' } };
    const pending = preparePublication(db, [remote]); completePublication(db, pending);
    expect(readRecords(db)[0].version).toEqual(remote.version);
    sqliteMergeFavorites(db, 'local', [{ ...item, isDeleted: true }]);
    expect(readRecords(db)[0].version.counter).toBe(101);
    db.run('UPDATE sync_device SET counter = ?', [Number.MAX_SAFE_INTEGER]);
    expect(() => sqliteMergeFavorites(db, 'local', [item])).toThrow('exhausted');
    expect(readRecords(db)[0].isDeleted).toBe(true);
    db.close();
  });
  it('versions local edits even while disabled, persists tombstones and keeps concurrent edits dirty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-sync-'));
    const file = path.join(dir, 'db');
    let db = await SqliteStorage.open({ dbPath: file });
    runMigrations(db);
    const item = { mediaType: 'anime', pluginId: 'p', mediaId: 'm' };
    sqliteMergeFavorites(db, 'cloud', [item]);
    expect(readRecords(db)).toHaveLength(0);
    sqliteMergeFavorites(db, 'local', [item]);
    sqliteMergeFavorites(db, 'local', [{ ...item, isDeleted: true }]);
    sqliteMergeTracking(db, 'local', [{ ...item, progress: .9, position: 90, updatedAt: '2099-01-01' }]);
    sqliteMergeTracking(db, 'local', [{ ...item, progress: .1, position: 10, updatedAt: '2000-01-01' }]);
    expect(readRecords(db).find(r => r.kind === 'progress')?.position).toBe(10);
    const pending = preparePublication(db, []);
    sqliteMergeFavorites(db, 'local', [item]);
    completePublication(db, pending);
    expect(getSyncState(db).counter).toBeGreaterThan(pending.counter);
    const device = getSyncState(db).device_id;
    db.close();
    db = await SqliteStorage.open({ dbPath: file });
    runMigrations(db);
    expect(getSyncState(db).device_id).toBe(device);
    expect(readRecords(db).find(r => r.kind === 'favorite')?.isDeleted).toBe(false);
    db.close();
  });
});
