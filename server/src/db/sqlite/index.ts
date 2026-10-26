import path from 'node:path';
import crypto from 'node:crypto';
import { SqliteStorage } from './storage';
import { runMigrations } from './migrations';
import { writeLocalRecord } from '../../sync/storage';

export * from './storage';
export * from './migrations';

let sqliteInstance: SqliteStorage | null = null;
let sqliteInitPromise: Promise<SqliteStorage> | null = null;

export interface SQLitePluginRow {
  id: string;
  identifier: string;
  name: string;
  version: string;
  types: string;
  author: string | null;
  code: string;
  is_builtin: number;
  install_count: number;
  is_active: number;
  created_at: string;
}

export function getDefaultSqlitePath(): string {
  if (process.env.TITANHUB_SQLITE_PATH) {
    return path.resolve(process.env.TITANHUB_SQLITE_PATH);
  }
  return path.resolve(process.cwd(), '.desktop-data/titanhub.db');
}

/**
 * Get or initialize the global SQLite storage instance.
 */
export async function getSqliteStorage(customPath?: string): Promise<SqliteStorage> {
  const targetPath = customPath ? path.resolve(customPath) : getDefaultSqlitePath();

  if (sqliteInstance && sqliteInstance.getPath() === targetPath) {
    return sqliteInstance;
  }

  if (sqliteInitPromise) {
    return sqliteInitPromise;
  }

  sqliteInitPromise = (async () => {
    const storage = await SqliteStorage.open({ dbPath: targetPath });
    runMigrations(storage);
    sqliteInstance = storage;
    return storage;
  })();

  return sqliteInitPromise;
}

/**
 * Close and reset current global SQLite storage instance.
 */
export function resetSqliteStorage(): void {
  if (sqliteInstance) {
    try {
      sqliteInstance.close();
    } catch {}
    sqliteInstance = null;
    sqliteInitPromise = null;
  }
}

export function mapSqliteRowToPlugin(row: SQLitePluginRow) {
  return {
    id: row.identifier,
    identifier: row.identifier,
    name: row.name,
    version: row.version || '1.0.0',
    types: (row.types ? row.types.split(',') : []) as ('anime' | 'manga' | 'novel' | 'movie')[],
    author: row.author || undefined,
    code: row.code,
    isBuiltin: Boolean(row.is_builtin),
    installCount: row.install_count,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

export function sqliteGetPlugins(storage: SqliteStorage) {
  const rows = storage.query<SQLitePluginRow>(`SELECT * FROM plugins;`);
  return rows.map(mapSqliteRowToPlugin);
}

export function sqliteGetPlugin(storage: SqliteStorage, id: string) {
  const row = storage.queryOne<SQLitePluginRow>(
    `SELECT * FROM plugins WHERE identifier = ? LIMIT 1;`,
    [id]
  );
  return row ? mapSqliteRowToPlugin(row) : null;
}

export function sqliteSavePlugin(
  storage: SqliteStorage,
  plugin: {
    id?: string;
    identifier?: string;
    name: string;
    version?: string;
    types?: string[];
    author?: string;
    code: string;
    isBuiltin?: boolean;
    installCount?: number;
    isActive?: boolean;
  }
) {
  const identifier = plugin.identifier || plugin.id || 'unknown';
  const typesStr = plugin.types ? plugin.types.join(',') : '';
  const existing = sqliteGetPlugin(storage, identifier);

  const isBuiltin = plugin.isBuiltin ? 1 : 0;
  // If plugin is built-in and user previously modified its active status, retain user's preference!
  const isActive =
    plugin.isBuiltin && existing?.isBuiltin
      ? existing.isActive
        ? 1
        : 0
      : plugin.isActive !== undefined
      ? plugin.isActive
        ? 1
        : 0
      : 1;

  if (existing) {
    if (
      plugin.isBuiltin &&
      existing.isBuiltin &&
      plugin.version === existing.version &&
      plugin.code === existing.code
    ) {
      return existing;
    }

    storage.run(
      `UPDATE plugins SET
        name = ?,
        version = ?,
        types = ?,
        author = ?,
        code = ?,
        is_builtin = ?,
        is_active = ?,
        install_count = ?
       WHERE identifier = ?;`,
      [
        plugin.name,
        plugin.version || '1.0.0',
        typesStr,
        plugin.author || null,
        plugin.code,
        isBuiltin,
        isActive,
        plugin.installCount ?? existing.installCount ?? 0,
        identifier,
      ]
    );
  } else {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    storage.run(
      `INSERT INTO plugins (
        id, identifier, name, version, types, author, code, is_builtin, install_count, is_active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        identifier,
        plugin.name,
        plugin.version || '1.0.0',
        typesStr,
        plugin.author || null,
        plugin.code,
        isBuiltin,
        plugin.installCount || 0,
        isActive,
        createdAt,
      ]
    );
  }

  return sqliteGetPlugin(storage, identifier)!;
}

export function sqliteSetPluginActive(storage: SqliteStorage, id: string, isActive: boolean) {
  storage.run(`UPDATE plugins SET is_active = ? WHERE identifier = ?;`, [isActive ? 1 : 0, id]);
  return sqliteGetPlugin(storage, id);
}

export function sqliteDeletePlugin(storage: SqliteStorage, id: string): boolean {
  const existing = sqliteGetPlugin(storage, id);
  if (!existing) return false;
  storage.run(`DELETE FROM plugins WHERE identifier = ?;`, [id]);
  return true;
}

// ---------------------------------------------------------------------------
// Tracking (watch/read progress)
// ---------------------------------------------------------------------------

export interface SqliteTrackingRow {
  id: string;
  user_id: string;
  media_type: string;
  media_id: string;
  plugin_id: string;
  chapter_no: number;
  chapter_id: string | null;
  progress: number;
  position: number | null;
  status: string;
  updated_at: string;
}

export interface TrackingInput {
  mediaId: string;
  pluginId: string;
  mediaType: string;
  chapterNo?: number;
  chapterId?: string;
  progress?: number;
  position?: number | null;
  status?: string;
  updatedAt?: string;
}

function normalizePosition(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function mapSqliteTrackingRow(row: SqliteTrackingRow) {
  return {
    id: row.id,
    userId: row.user_id,
    mediaType: row.media_type,
    mediaId: row.media_id,
    pluginId: row.plugin_id,
    chapterNo: row.chapter_no,
    chapterId: row.chapter_id,
    progress: row.progress,
    position: row.position ?? null,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export function sqliteGetTracking(storage: SqliteStorage, userId: string) {
  const rows = storage.query<SqliteTrackingRow>(
    `SELECT * FROM tracking WHERE user_id = ? ORDER BY updated_at DESC;`,
    [userId]
  );
  return rows.map(mapSqliteTrackingRow);
}

/**
 * Merge tracking logs using Last-Write-Wins on updated_at. Returns the merged list.
 */
export function sqliteMergeTracking(
  storage: SqliteStorage,
  userId: string,
  items: TrackingInput[]
) {
  if (userId === 'local') {
    storage.transaction(() => {
      for (const item of items.filter(i => i && i.mediaId && i.pluginId && i.mediaType)) {
        const existing = sqliteGetTracking(storage, userId).find(r => r.mediaType === item.mediaType && r.pluginId === item.pluginId && r.mediaId === item.mediaId);
        writeLocalRecord(storage, { kind: 'progress', mediaType: item.mediaType, pluginId: item.pluginId, mediaId: item.mediaId,
          chapterId: item.chapterId ?? existing?.chapterId ?? '', chapterNo: item.chapterNo ?? existing?.chapterNo ?? 0,
          progress: item.progress ?? existing?.progress ?? 0, position: normalizePosition(item.position),
          status: item.status ?? existing?.status ?? 'watching', updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString() });
      }
    });
    return sqliteGetTracking(storage, userId);
  }
  const valid = items.filter((i) => i && i.mediaId && i.pluginId && i.mediaType);
  if (valid.length > 0) {
    storage.transaction(() => {
      for (const item of valid) {
        const incomingUpdatedAt = item.updatedAt
          ? new Date(item.updatedAt).toISOString()
          : new Date().toISOString();
        const existing = storage.queryOne<SqliteTrackingRow>(
          `SELECT * FROM tracking WHERE user_id = ? AND media_type = ? AND plugin_id = ? AND media_id = ? LIMIT 1;`,
          [userId, item.mediaType, item.pluginId, item.mediaId]
        );
        if (existing) {
          if (incomingUpdatedAt > existing.updated_at) {
            storage.run(
              `UPDATE tracking SET chapter_no = ?, chapter_id = ?, progress = ?, position = ?, status = ?, updated_at = ? WHERE id = ?;`,
              [
                item.chapterNo ?? existing.chapter_no,
                item.chapterId ?? existing.chapter_id,
                item.progress ?? existing.progress,
                normalizePosition(item.position),
                item.status ?? existing.status,
                incomingUpdatedAt,
                existing.id,
              ]
            );
          }
        } else {
          storage.run(
            `INSERT INTO tracking (id, user_id, media_type, media_id, plugin_id, chapter_no, chapter_id, progress, position, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              crypto.randomUUID(),
              userId,
              item.mediaType,
              item.mediaId,
              item.pluginId,
              item.chapterNo ?? 0,
              item.chapterId ?? '',
              item.progress ?? 0,
              normalizePosition(item.position),
              item.status ?? 'watching',
              incomingUpdatedAt,
            ]
          );
        }
      }
    });
  }
  return sqliteGetTracking(storage, userId);
}

// ---------------------------------------------------------------------------
// Favorites (bookmarks)
// ---------------------------------------------------------------------------

export interface SqliteFavoriteRow {
  id: string;
  user_id: string;
  media_type: string;
  media_id: string;
  plugin_id: string;
  created_at: string;
}

export interface FavoriteInput {
  mediaId: string;
  pluginId: string;
  mediaType: string;
  isDeleted?: boolean;
}

export function mapSqliteFavoriteRow(row: SqliteFavoriteRow) {
  return {
    id: row.id,
    userId: row.user_id,
    mediaType: row.media_type,
    mediaId: row.media_id,
    pluginId: row.plugin_id,
    createdAt: row.created_at,
  };
}

export function sqliteGetFavorites(storage: SqliteStorage, userId: string) {
  const rows = storage.query<SqliteFavoriteRow>(
    `SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC;`,
    [userId]
  );
  return rows.map(mapSqliteFavoriteRow);
}

/**
 * Merge favorites: insert new entries, apply soft deletions. Returns the final list.
 */
export function sqliteMergeFavorites(
  storage: SqliteStorage,
  userId: string,
  items: FavoriteInput[]
) {
  if (userId === 'local') {
    storage.transaction(() => {
      for (const item of items.filter(i => i && i.mediaId && i.pluginId && i.mediaType)) {
        writeLocalRecord(storage, { kind: 'favorite', mediaType: item.mediaType, pluginId: item.pluginId,
          mediaId: item.mediaId, isDeleted: item.isDeleted ?? false, updatedAt: new Date().toISOString() });
      }
    });
    return sqliteGetFavorites(storage, userId);
  }
  const valid = items.filter((i) => i && i.mediaId && i.pluginId && i.mediaType);
  if (valid.length > 0) {
    storage.transaction(() => {
      for (const item of valid) {
        if (item.isDeleted) {
          storage.run(
            `DELETE FROM favorites WHERE user_id = ? AND media_type = ? AND plugin_id = ? AND media_id = ?;`,
            [userId, item.mediaType, item.pluginId, item.mediaId]
          );
        } else {
          storage.run(
            `INSERT OR IGNORE INTO favorites (id, user_id, media_type, media_id, plugin_id, created_at) VALUES (?, ?, ?, ?, ?, ?);`,
            [
              crypto.randomUUID(),
              userId,
              item.mediaType,
              item.mediaId,
              item.pluginId,
              new Date().toISOString(),
            ]
          );
        }
      }
    });
  }
  return sqliteGetFavorites(storage, userId);
}

// ---------------------------------------------------------------------------
// Watch/read history
// ---------------------------------------------------------------------------

export interface SqliteHistoryRow {
  id: string;
  user_id: string;
  media_type: string;
  media_id: string;
  plugin_id: string;
  chapter_id: string;
  chapter_no: number;
  title: string | null;
  cover: string | null;
  progress: number;
  watched_at: string;
}

export interface HistoryInput {
  mediaId: string;
  pluginId: string;
  mediaType: string;
  chapterId?: string;
  chapterNo?: number;
  title?: string;
  cover?: string;
  progress?: number;
  watchedAt?: string;
}

export function mapSqliteHistoryRow(row: SqliteHistoryRow) {
  return {
    id: row.id,
    userId: row.user_id,
    mediaType: row.media_type,
    mediaId: row.media_id,
    pluginId: row.plugin_id,
    chapterId: row.chapter_id,
    chapterNo: row.chapter_no,
    title: row.title,
    cover: row.cover,
    progress: row.progress,
    watchedAt: row.watched_at,
  };
}

export function sqliteGetHistory(storage: SqliteStorage, userId: string, limit = 200) {
  const rows = storage.query<SqliteHistoryRow>(
    `SELECT * FROM history WHERE user_id = ? ORDER BY watched_at DESC LIMIT ?;`,
    [userId, limit]
  );
  return rows.map(mapSqliteHistoryRow);
}

/**
 * Record (or refresh) a history entry. One row per (user, media, chapter):
 * re-watching the same chapter updates progress/watched_at instead of duplicating.
 */
export function sqliteRecordHistory(storage: SqliteStorage, userId: string, item: HistoryInput) {
  const chapterId = item.chapterId ?? '';
  const watchedAt = item.watchedAt
    ? new Date(item.watchedAt).toISOString()
    : new Date().toISOString();
  const existing = storage.queryOne<SqliteHistoryRow>(
    `SELECT * FROM history WHERE user_id = ? AND media_type = ? AND plugin_id = ? AND media_id = ? AND chapter_id = ? LIMIT 1;`,
    [userId, item.mediaType, item.pluginId, item.mediaId, chapterId]
  );
  if (existing) {
    storage.run(
      `UPDATE history SET chapter_no = ?, title = ?, cover = ?, progress = ?, watched_at = ? WHERE id = ?;`,
      [
        item.chapterNo ?? existing.chapter_no,
        item.title ?? existing.title,
        item.cover ?? existing.cover,
        item.progress ?? existing.progress,
        watchedAt,
        existing.id,
      ]
    );
  } else {
    storage.run(
      `INSERT INTO history (id, user_id, media_type, media_id, plugin_id, chapter_id, chapter_no, title, cover, progress, watched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        crypto.randomUUID(),
        userId,
        item.mediaType,
        item.mediaId,
        item.pluginId,
        chapterId,
        item.chapterNo ?? 0,
        item.title ?? null,
        item.cover ?? null,
        item.progress ?? 0,
        watchedAt,
      ]
    );
  }
  return sqliteGetHistory(storage, userId);
}

export function sqliteClearHistory(storage: SqliteStorage, userId: string, id?: string) {
  if (id) {
    storage.run(`DELETE FROM history WHERE user_id = ? AND id = ?;`, [userId, id]);
  } else {
    storage.run(`DELETE FROM history WHERE user_id = ?;`, [userId]);
  }
  return sqliteGetHistory(storage, userId);
}

// ---------------------------------------------------------------------------
// Settings (key-value, with version/timestamp conflict resolution for sync)
// ---------------------------------------------------------------------------

export interface SqliteSettingRow {
  user_id: string;
  key: string;
  value: string | null;
  version: number;
  updated_at: string;
}

export function sqliteGetSettings(storage: SqliteStorage, userId: string) {
  return storage
    .query<SqliteSettingRow>(`SELECT * FROM settings WHERE user_id = ?;`, [userId])
    .map((row) => ({
      userId: row.user_id,
      key: row.key,
      value: row.value,
      version: row.version,
      updatedAt: row.updated_at,
    }));
}

/**
 * Upsert a setting. Conflict strategy: higher version wins; on tie, newer updated_at wins.
 * Returns true when the incoming value was applied.
 */
export function sqliteUpsertSetting(
  storage: SqliteStorage,
  userId: string,
  key: string,
  value: string | null,
  updatedAt?: string,
  version?: number
): boolean {
  const ts = updatedAt ? new Date(updatedAt).toISOString() : new Date().toISOString();
  const existing = storage.queryOne<SqliteSettingRow>(
    `SELECT * FROM settings WHERE user_id = ? AND key = ? LIMIT 1;`,
    [userId, key]
  );
  if (existing) {
    const incomingVersion = version ?? existing.version + 1;
    const incomingWins =
      incomingVersion > existing.version ||
      (incomingVersion === existing.version && ts > existing.updated_at);
    if (!incomingWins) return false;
    storage.run(
      `UPDATE settings SET value = ?, version = ?, updated_at = ? WHERE user_id = ? AND key = ?;`,
      [value, incomingVersion, ts, userId, key]
    );
    return true;
  }
  storage.run(
    `INSERT INTO settings (user_id, key, value, version, updated_at) VALUES (?, ?, ?, ?, ?);`,
    [userId, key, value, version ?? 1, ts]
  );
  return true;
}
