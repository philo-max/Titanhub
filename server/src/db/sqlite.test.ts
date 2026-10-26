import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  SqliteStorage,
  runMigrations,
  getCurrentVersion,
  MIGRATIONS,
  sqliteGetPlugins,
  sqliteGetPlugin,
  sqliteSavePlugin,
  sqliteSetPluginActive,
  sqliteDeletePlugin,
  sqliteGetTracking,
  sqliteMergeTracking,
  sqliteGetFavorites,
  sqliteMergeFavorites,
  sqliteGetHistory,
  sqliteRecordHistory,
  sqliteClearHistory,
  sqliteGetSettings,
  sqliteUpsertSetting,
} from './sqlite';

describe('SQLite Data Layer & Migrations (Task 2.1)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'titanhub-sqlite-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it('Test 1: Fresh Initialization - creates database file, applies v1 schema & all tables', async () => {
    const dbPath = path.join(tmpDir, 'data', 'fresh.db');
    expect(fs.existsSync(dbPath)).toBe(false);

    // 1. Open storage (should automatically create directories and file)
    const storage = await SqliteStorage.open({ dbPath });
    expect(fs.existsSync(dbPath)).toBe(true);

    // 2. Run migrations
    const migrationResult = runMigrations(storage);
    expect(migrationResult.currentVersion).toBe(MIGRATIONS.length);
    expect(migrationResult.appliedCount).toBe(MIGRATIONS.length);
    expect(getCurrentVersion(storage)).toBe(MIGRATIONS.length);

    // 3. Verify all tables created in SQLite
    const tables = storage
      .query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`
      )
      .map((t) => t.name);

    expect(tables).toContain('_schema_meta');
    expect(tables).toContain('plugins');
    expect(tables).toContain('tracking');
    expect(tables).toContain('favorites');
    expect(tables).toContain('danmaku');
    expect(tables).toContain('media_views');
    expect(tables).toContain('history');
    expect(tables).toContain('settings');

    // 4. Verify _schema_meta record
    const metaRow = storage.queryOne<{ version: number; description: string }>(
      `SELECT version, description FROM _schema_meta WHERE version = 1;`
    );
    expect(metaRow?.version).toBe(1);
    expect(metaRow?.description).toContain('Initial schema');

    // 5. Verify initial table is queryable via sqliteGetPlugins
    expect(sqliteGetPlugins(storage).length).toBe(0);

    storage.close();
  });

  it('Test 2: Persistence Across Restart - preserves custom plugins and user toggle states', async () => {
    const dbPath = path.join(tmpDir, 'persist.db');

    // Step 1: First startup & seed
    const storage1 = await SqliteStorage.open({ dbPath });
    runMigrations(storage1);

    // Save a custom user plugin
    sqliteSavePlugin(storage1, {
      identifier: 'user-custom-plugin',
      name: 'My Custom Scraper',
      version: '2.0.0',
      types: ['anime'],
      code: 'function test() {}',
      isBuiltin: false,
      isActive: true,
    });

    // Save a builtin plugin
    sqliteSavePlugin(storage1, {
      identifier: 'builtin-source-1',
      name: 'Builtin Source',
      version: '1.0.0',
      types: ['manga'],
      code: 'function source() {}',
      isBuiltin: true,
      isActive: true,
    });

    // User disables the builtin plugin
    const disabled = sqliteSetPluginActive(storage1, 'builtin-source-1', false);
    expect(disabled?.isActive).toBe(false);

    // Close process / database
    storage1.close();

    // Step 2: Second startup (restart)
    const storage2 = await SqliteStorage.open({ dbPath });
    runMigrations(storage2);

    // Verify custom plugin persisted
    const loadedCustom = sqliteGetPlugin(storage2, 'user-custom-plugin');
    expect(loadedCustom).not.toBeNull();
    expect(loadedCustom?.name).toBe('My Custom Scraper');
    expect(loadedCustom?.isBuiltin).toBe(false);

    // Verify builtin plugin is still disabled
    const loadedBuiltin = sqliteGetPlugin(storage2, 'builtin-source-1');
    expect(loadedBuiltin).not.toBeNull();
    expect(loadedBuiltin?.isActive).toBe(false);

    // Re-seed with builtin defaults (simulating server startup builtin loader)
    const reseeded = sqliteSavePlugin(storage2, {
      identifier: 'builtin-source-1',
      name: 'Builtin Source',
      version: '1.0.0',
      types: ['manga'],
      code: 'function source() {}',
      isBuiltin: true,
      isActive: true, // Seeder passes true, but user preference must NOT be overwritten!
    });
    expect(reseeded.isActive).toBe(false);

    // Verify deletion
    const deleted = sqliteDeletePlugin(storage2, 'user-custom-plugin');
    expect(deleted).toBe(true);
    expect(sqliteGetPlugin(storage2, 'user-custom-plugin')).toBeNull();

    storage2.close();
  });

  it('Test 3: Schema Migrations - safely upgrades schema and preserves existing data', async () => {
    const dbPath = path.join(tmpDir, 'migration.db');

    // Step 1: Initialize database (v1 + v2 + v3 applied)
    const storage = await SqliteStorage.open({ dbPath });
    runMigrations(storage);
    expect(getCurrentVersion(storage)).toBe(MIGRATIONS.length);

    // Insert data into v1 table
    sqliteSavePlugin(storage, {
      identifier: 'v1-plugin',
      name: 'V1 Plugin',
      code: 'function v1() {}',
    });

    // Step 2: Define v3 migration dynamically
    const v3Migration = {
      version: MIGRATIONS.length + 1,
      description: 'Add description column to plugins',
      up: (s: SqliteStorage) => {
        s.exec(`ALTER TABLE plugins ADD COLUMN description TEXT;`);
      },
    };

    MIGRATIONS.push(v3Migration);
    try {
      const upgradeResult = runMigrations(storage);
      expect(upgradeResult.currentVersion).toBe(v3Migration.version);
      expect(upgradeResult.appliedCount).toBe(1);
      expect(getCurrentVersion(storage)).toBe(v3Migration.version);

      // Verify existing data is preserved
      const existing = sqliteGetPlugin(storage, 'v1-plugin');
      expect(existing?.name).toBe('V1 Plugin');

      // Verify new column is queryable
      storage.run(`UPDATE plugins SET description = ? WHERE identifier = ?;`, [
        'Added in v2',
        'v1-plugin',
      ]);
      const row = storage.queryOne<{ description: string }>(
        `SELECT description FROM plugins WHERE identifier = ?;`,
        ['v1-plugin']
      );
      expect(row?.description).toBe('Added in v2');

      // Re-running migrations when up-to-date does nothing
      const noop = runMigrations(storage);
      expect(noop.appliedCount).toBe(0);
    } finally {
      // Clean up dynamic migration
      const idx = MIGRATIONS.findIndex((m) => m === v3Migration);
      if (idx !== -1) MIGRATIONS.splice(idx, 1);
      storage.close();
    }
  });

  it('Test 4: Local Data Layer - tracking/favorites/history/settings persist & merge across restart', async () => {
    const dbPath = path.join(tmpDir, 'local-data.db');
    const userId = 'local-user';

    // --- First session: write all four data types ---
    const s1 = await SqliteStorage.open({ dbPath });
    runMigrations(s1);

    // Tracking: two items
    let tracking = sqliteMergeTracking(s1, userId, [
      { mediaId: 'm1', pluginId: 'p1', mediaType: 'anime', chapterNo: 3, chapterId: 'ep3', progress: 0.5, status: 'watching', updatedAt: '2026-01-01T10:00:00.000Z' },
      { mediaId: 'm2', pluginId: 'p1', mediaType: 'manga', chapterNo: 12, progress: 0.9, status: 'completed', updatedAt: '2026-01-01T11:00:00.000Z' },
    ]);
    expect(tracking.length).toBe(2);

    // LWW: older update must NOT overwrite newer progress
    tracking = sqliteMergeTracking(s1, userId, [
      { mediaId: 'm1', pluginId: 'p1', mediaType: 'anime', chapterNo: 1, progress: 0.1, updatedAt: '2025-12-31T09:00:00.000Z' },
    ]);
    expect(tracking.find((t) => t.mediaId === 'm1')?.progress).toBe(0.5);

    // Newer update wins
    tracking = sqliteMergeTracking(s1, userId, [
      { mediaId: 'm1', pluginId: 'p1', mediaType: 'anime', chapterNo: 4, chapterId: 'ep4', progress: 0.75, updatedAt: '2026-01-02T10:00:00.000Z' },
    ]);
    expect(tracking.find((t) => t.mediaId === 'm1')?.progress).toBe(0.75);
    expect(tracking.find((t) => t.mediaId === 'm1')?.chapterNo).toBe(4);

    // Favorites: add two, delete one
    let favorites = sqliteMergeFavorites(s1, userId, [
      { mediaId: 'm1', pluginId: 'p1', mediaType: 'anime' },
      { mediaId: 'm2', pluginId: 'p1', mediaType: 'manga' },
    ]);
    expect(favorites.length).toBe(2);
    favorites = sqliteMergeFavorites(s1, userId, [
      { mediaId: 'm1', pluginId: 'p1', mediaType: 'anime' }, // duplicate insert is ignored
      { mediaId: 'm2', pluginId: 'p1', mediaType: 'manga', isDeleted: true },
    ]);
    expect(favorites.length).toBe(1);
    expect(favorites[0].mediaId).toBe('m1');

    // History: record, then rewatch same chapter -> still one row with refreshed progress
    let history = sqliteRecordHistory(s1, userId, {
      mediaId: 'm1', pluginId: 'p1', mediaType: 'anime', chapterId: 'ep3', chapterNo: 3, progress: 0.5, title: '测试番剧', watchedAt: '2026-01-01T12:00:00.000Z',
    });
    expect(history.length).toBe(1);
    history = sqliteRecordHistory(s1, userId, {
      mediaId: 'm1', pluginId: 'p1', mediaType: 'anime', chapterId: 'ep3', chapterNo: 3, progress: 1.0, watchedAt: '2026-01-01T13:00:00.000Z',
    });
    expect(history.length).toBe(1);
    expect(history[0].progress).toBe(1.0);
    expect(history[0].title).toBe('测试番剧');

    // Settings: version/timestamp conflict resolution
    expect(sqliteUpsertSetting(s1, userId, 'theme', 'dark', '2026-01-01T10:00:00.000Z', 1)).toBe(true);
    // Lower version loses
    expect(sqliteUpsertSetting(s1, userId, 'theme', 'light', '2026-01-02T10:00:00.000Z', 0)).toBe(false);
    // Same version but older timestamp loses
    expect(sqliteUpsertSetting(s1, userId, 'theme', 'light', '2025-12-31T10:00:00.000Z', 1)).toBe(false);
    // Higher version wins
    expect(sqliteUpsertSetting(s1, userId, 'theme', 'light', '2026-01-02T10:00:00.000Z', 2)).toBe(true);

    s1.close();

    // --- Second session (restart): everything must still be there ---
    const s2 = await SqliteStorage.open({ dbPath });
    runMigrations(s2);

    const persistedTracking = sqliteGetTracking(s2, userId);
    expect(persistedTracking.length).toBe(2);
    expect(persistedTracking.find((t) => t.mediaId === 'm1')?.progress).toBe(0.75);

    const persistedFavorites = sqliteGetFavorites(s2, userId);
    expect(persistedFavorites.length).toBe(1);
    expect(persistedFavorites[0].mediaId).toBe('m1');

    const persistedHistory = sqliteGetHistory(s2, userId);
    expect(persistedHistory.length).toBe(1);
    expect(persistedHistory[0].progress).toBe(1.0);

    const persistedSettings = sqliteGetSettings(s2, userId);
    const theme = persistedSettings.find((s) => s.key === 'theme');
    expect(theme?.value).toBe('light');
    expect(theme?.version).toBe(2);

    // Clear history API
    expect(sqliteClearHistory(s2, userId).length).toBe(0);

    s2.close();
  });
});

describe('SQLite v3 composite media key migration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'titanhub-sqlite-v3-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function createLegacyV2Database(storage: SqliteStorage) {
    for (const migration of MIGRATIONS.filter((m) => m.version <= 2)) {
      migration.up(storage);
      storage.run(`INSERT INTO _schema_meta (version, applied_at, description) VALUES (?, ?, ?);`, [
        migration.version,
        '2026-01-01T00:00:00.000Z',
        migration.description,
      ]);
    }
    const rows: [string, string, string, string, string, number, string, number, string][] = [
      ['t1', 'local', 'anime', 'same-id', 'plugin-a', 3, 'ep3', 0.5, '2026-01-01T10:00:00.000Z'],
      ['t2', 'cloud-user-1', 'manga', 'same-id', 'plugin-a', 7, 'ch7', 0.25, '2026-01-02T10:00:00.000Z'],
      ['t3', 'cloud-user-1', 'novel', 'n-1', 'plugin-n', 1, '', 0.9, '2026-01-03T10:00:00.000Z'],
    ];
    for (const r of rows) {
      storage.run(
        `INSERT INTO tracking (id, user_id, media_type, media_id, plugin_id, chapter_no, chapter_id, progress, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'watching', ?);`,
        r
      );
    }
    storage.run(
      `INSERT INTO favorites (id, user_id, media_type, media_id, plugin_id, created_at) VALUES ('f1', 'local', 'anime', 'same-id', 'plugin-a', '2026-01-01T00:00:00.000Z'), ('f2', 'cloud-user-1', 'manga', 'same-id', 'plugin-a', '2026-01-01T00:00:00.000Z');`
    );
    storage.run(
      `INSERT INTO history (id, user_id, media_type, media_id, plugin_id, chapter_id, chapter_no, title, cover, progress, watched_at) VALUES ('h1', 'local', 'anime', 'same-id', 'plugin-a', 'ep3', 3, 'Title', NULL, 0.5, '2026-01-01T12:00:00.000Z'), ('h2', 'cloud-user-1', 'manga', 'same-id', 'plugin-a', 'ch7', 7, NULL, NULL, 0.25, '2026-01-02T12:00:00.000Z');`
    );
  }

  it('upgrades a legacy v2 database, keeps every row and a backup, and is idempotent', async () => {
    const dbPath = path.join(tmpDir, 'legacy.db');
    const legacy = await SqliteStorage.open({ dbPath });
    createLegacyV2Database(legacy);
    expect(getCurrentVersion(legacy)).toBe(2);
    legacy.close();

    const storage = await SqliteStorage.open({ dbPath });
    const result = runMigrations(storage);
    expect(result).toEqual({ currentVersion: MIGRATIONS.length, appliedCount: MIGRATIONS.length - 2 });

    const tracking = storage.query<{ id: string; user_id: string; position: number | null }>(
      `SELECT id, user_id, position FROM tracking ORDER BY id;`
    );
    expect(tracking.map((t) => `${t.id}:${t.user_id}`)).toEqual(['t1:local', 't2:cloud-user-1', 't3:cloud-user-1']);
    expect(tracking.every((t) => t.position === null)).toBe(true);
    expect(storage.query(`SELECT id FROM favorites ORDER BY id;`).map((r: any) => r.id)).toEqual(['f1', 'f2']);
    expect(storage.query(`SELECT id FROM history ORDER BY id;`).map((r: any) => r.id)).toEqual(['h1', 'h2']);

    for (const table of ['tracking_legacy_v2', 'favorites_legacy_v2', 'history_legacy_v2']) {
      const count = storage.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table};`);
      expect(count?.n).toBeGreaterThan(0);
    }

    expect(runMigrations(storage).appliedCount).toBe(0);
    storage.close();

    const reopened = await SqliteStorage.open({ dbPath });
    expect(runMigrations(reopened).appliedCount).toBe(0);
    expect(sqliteGetTracking(reopened, 'cloud-user-1')).toHaveLength(2);
    expect(sqliteGetTracking(reopened, 'local')).toHaveLength(1);
    reopened.close();
  });

  it('isolates the same mediaId across media types and plugins for tracking, favourites and history', async () => {
    const storage = await SqliteStorage.open({ dbPath: path.join(tmpDir, 'keys.db') });
    runMigrations(storage);
    const userId = 'local';

    let tracking = sqliteMergeTracking(storage, userId, [
      { mediaId: 'x', pluginId: 'p1', mediaType: 'anime', chapterId: 'e1', chapterNo: 1, progress: 0.4, position: 120, updatedAt: '2026-01-01T10:00:00.000Z' },
      { mediaId: 'x', pluginId: 'p2', mediaType: 'anime', chapterId: 'e9', chapterNo: 9, progress: 0.2, position: 30, updatedAt: '2026-01-01T10:00:00.000Z' },
      { mediaId: 'x', pluginId: 'p1', mediaType: 'manga', chapterId: 'c1', chapterNo: 1, progress: 0.5, position: 4, updatedAt: '2026-01-01T10:00:00.000Z' },
    ]);
    expect(tracking).toHaveLength(3);

    tracking = sqliteMergeTracking(storage, userId, [
      { mediaId: 'x', pluginId: 'p1', mediaType: 'anime', chapterId: 'e1', chapterNo: 1, progress: 0.05, position: 15, updatedAt: '2026-01-01T11:00:00.000Z' },
    ]);
    const animeP1 = tracking.find((t) => t.pluginId === 'p1' && t.mediaType === 'anime');
    const animeP2 = tracking.find((t) => t.pluginId === 'p2');
    expect(animeP1).toMatchObject({ progress: 0.05, position: 15 });
    expect(animeP2).toMatchObject({ progress: 0.2, position: 30, chapterId: 'e9' });

    tracking = sqliteMergeTracking(storage, userId, [
      { mediaId: 'x', pluginId: 'p1', mediaType: 'anime', chapterId: 'e1', progress: 0.3, position: Number.NaN as any, updatedAt: '2026-01-01T12:00:00.000Z' },
    ]);
    expect(tracking.find((t) => t.pluginId === 'p1' && t.mediaType === 'anime')?.position).toBeNull();

    let favorites = sqliteMergeFavorites(storage, userId, [
      { mediaId: 'x', pluginId: 'p1', mediaType: 'anime' },
      { mediaId: 'x', pluginId: 'p2', mediaType: 'anime' },
      { mediaId: 'x', pluginId: 'p1', mediaType: 'manga' },
    ]);
    expect(favorites).toHaveLength(3);
    favorites = sqliteMergeFavorites(storage, userId, [{ mediaId: 'x', pluginId: 'p2', mediaType: 'anime', isDeleted: true }]);
    expect(favorites.map((f) => `${f.mediaType}/${f.pluginId}`).sort()).toEqual(['anime/p1', 'manga/p1']);

    sqliteRecordHistory(storage, userId, { mediaId: 'x', pluginId: 'p1', mediaType: 'anime', chapterId: 'e1', progress: 0.1 });
    const history = sqliteRecordHistory(storage, userId, { mediaId: 'x', pluginId: 'p2', mediaType: 'anime', chapterId: 'e1', progress: 0.2 });
    expect(history).toHaveLength(2);

    storage.close();
  });
});
