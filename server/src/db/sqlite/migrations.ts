import { SqliteStorage } from './storage';

export interface Migration {
  version: number;
  description: string;
  up: (storage: SqliteStorage) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema: _schema_meta, plugins, tracking, favorites, danmaku, media_views',
    up: (storage: SqliteStorage) => {
      // 1. Schema metadata table
      storage.exec(`
        CREATE TABLE IF NOT EXISTS _schema_meta (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL,
          description TEXT
        );
      `);

      // 2. Plugins table
      storage.exec(`
        CREATE TABLE IF NOT EXISTS plugins (
          id TEXT PRIMARY KEY,
          identifier TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          version TEXT DEFAULT '1.0.0',
          types TEXT,
          author TEXT,
          code TEXT NOT NULL,
          is_builtin INTEGER DEFAULT 0 NOT NULL,
          install_count INTEGER DEFAULT 0 NOT NULL,
          is_active INTEGER DEFAULT 1 NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_plugins_identifier ON plugins(identifier);
      `);

      // 3. Tracking table
      storage.exec(`
        CREATE TABLE IF NOT EXISTS tracking (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          media_type TEXT NOT NULL,
          media_id TEXT NOT NULL,
          plugin_id TEXT NOT NULL,
          chapter_no INTEGER DEFAULT 0 NOT NULL,
          chapter_id TEXT,
          progress REAL DEFAULT 0.0 NOT NULL,
          status TEXT DEFAULT 'watching' NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(user_id, media_id)
        );
        CREATE INDEX IF NOT EXISTS idx_tracking_user ON tracking(user_id);
      `);

      // 4. Favorites table
      storage.exec(`
        CREATE TABLE IF NOT EXISTS favorites (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          media_type TEXT NOT NULL,
          media_id TEXT NOT NULL,
          plugin_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(user_id, media_id)
        );
        CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
      `);

      // 5. Danmaku table
      storage.exec(`
        CREATE TABLE IF NOT EXISTS danmaku (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          media_id TEXT NOT NULL,
          plugin_id TEXT NOT NULL,
          episode TEXT NOT NULL,
          time_offset REAL NOT NULL,
          content TEXT NOT NULL,
          color TEXT DEFAULT '#FFFFFF' NOT NULL,
          user_hash TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_danmaku_media_ep ON danmaku(media_id, episode);
      `);

      // 6. Media Views table
      storage.exec(`
        CREATE TABLE IF NOT EXISTS media_views (
          id TEXT PRIMARY KEY,
          media_type TEXT NOT NULL,
          media_id TEXT NOT NULL,
          plugin_id TEXT NOT NULL,
          title TEXT NOT NULL,
          cover TEXT,
          views INTEGER DEFAULT 0 NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(plugin_id, media_id, media_type)
        );
      `);
    },
  },
  {
    version: 2,
    description: 'Local-first data layer: history & settings tables',
    up: (storage: SqliteStorage) => {
      // 7. Watch/read history table (one row per user+media+chapter, refreshed on rewatch)
      storage.exec(`
        CREATE TABLE IF NOT EXISTS history (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          media_type TEXT NOT NULL,
          media_id TEXT NOT NULL,
          plugin_id TEXT NOT NULL,
          chapter_id TEXT DEFAULT '' NOT NULL,
          chapter_no INTEGER DEFAULT 0 NOT NULL,
          title TEXT,
          cover TEXT,
          progress REAL DEFAULT 0.0 NOT NULL,
          watched_at TEXT NOT NULL,
          UNIQUE(user_id, media_id, chapter_id)
        );
        CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, watched_at);
      `);

      // 8. Per-user settings key-value store (version + updated_at for sync conflict resolution)
      storage.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          user_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT,
          version INTEGER DEFAULT 1 NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, key)
        );
      `);
    },
  },
  {
    version: 3,
    description: 'Composite media keys (user, media_type, plugin_id, media_id) and tracking position',
    up: (storage: SqliteStorage) => {
      rebuildTableWithBackup(storage, {
        table: 'tracking',
        createSql: `
          CREATE TABLE tracking (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            media_type TEXT NOT NULL,
            media_id TEXT NOT NULL,
            plugin_id TEXT NOT NULL,
            chapter_no INTEGER DEFAULT 0 NOT NULL,
            chapter_id TEXT,
            progress REAL DEFAULT 0.0 NOT NULL,
            position REAL,
            status TEXT DEFAULT 'watching' NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, media_type, plugin_id, media_id)
          );
          CREATE INDEX idx_tracking_user_v3 ON tracking(user_id, updated_at);
        `,
        columns: ['id', 'user_id', 'media_type', 'media_id', 'plugin_id', 'chapter_no', 'chapter_id', 'progress', 'status', 'updated_at'],
      });
      rebuildTableWithBackup(storage, {
        table: 'favorites',
        createSql: `
          CREATE TABLE favorites (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            media_type TEXT NOT NULL,
            media_id TEXT NOT NULL,
            plugin_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(user_id, media_type, plugin_id, media_id)
          );
          CREATE INDEX idx_favorites_user_v3 ON favorites(user_id, created_at);
        `,
        columns: ['id', 'user_id', 'media_type', 'media_id', 'plugin_id', 'created_at'],
      });
      rebuildTableWithBackup(storage, {
        table: 'history',
        createSql: `
          CREATE TABLE history (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            media_type TEXT NOT NULL,
            media_id TEXT NOT NULL,
            plugin_id TEXT NOT NULL,
            chapter_id TEXT DEFAULT '' NOT NULL,
            chapter_no INTEGER DEFAULT 0 NOT NULL,
            title TEXT,
            cover TEXT,
            progress REAL DEFAULT 0.0 NOT NULL,
            watched_at TEXT NOT NULL,
            UNIQUE(user_id, media_type, plugin_id, media_id, chapter_id)
          );
          CREATE INDEX idx_history_user_v3 ON history(user_id, watched_at);
        `,
        columns: ['id', 'user_id', 'media_type', 'media_id', 'plugin_id', 'chapter_id', 'chapter_no', 'title', 'cover', 'progress', 'watched_at'],
      });
    },
  },
];

MIGRATIONS.push({
  version: 4,
  description: 'Local sync device state, versioned records and durable publications',
  up: (storage) => {
    storage.exec(`
      CREATE TABLE sync_device (id INTEGER PRIMARY KEY CHECK(id = 1), device_id TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0,
        imported INTEGER NOT NULL DEFAULT 0, published_counter INTEGER NOT NULL DEFAULT 0, last_success_at TEXT);
      CREATE TABLE sync_records (kind TEXT NOT NULL, media_key TEXT NOT NULL, record TEXT NOT NULL,
        PRIMARY KEY(kind, media_key));
      CREATE TABLE sync_pending (id INTEGER PRIMARY KEY CHECK(id = 1), generation INTEGER NOT NULL,
        counter INTEGER NOT NULL, bytes TEXT NOT NULL);
    `);
  },
});

interface TableRebuild {
  table: string;
  createSql: string;
  columns: string[];
}

function rebuildTableWithBackup(storage: SqliteStorage, spec: TableRebuild): void {
  const backup = `${spec.table}_legacy_v2`;
  const columnList = spec.columns.join(', ');
  const before = storage.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${spec.table};`)?.n ?? 0;

  storage.exec(`ALTER TABLE ${spec.table} RENAME TO ${backup};`);
  storage.exec(spec.createSql);
  storage.exec(`INSERT INTO ${spec.table} (${columnList}) SELECT ${columnList} FROM ${backup};`);

  const copied = storage.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${spec.table};`)?.n ?? 0;
  const missing =
    storage.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${backup} WHERE id NOT IN (SELECT id FROM ${spec.table});`
    )?.n ?? 0;
  if (copied !== before || missing !== 0) {
    throw new Error(
      `[sqlite] Migration v3 verification failed for ${spec.table}: expected ${before} rows, copied ${copied}, missing ${missing}.`
    );
  }
}

/**
 * Ensure _schema_meta table exists.
 */
export function ensureSchemaMetaTable(storage: SqliteStorage): void {
  storage.exec(`
    CREATE TABLE IF NOT EXISTS _schema_meta (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT
    );
  `);
}

/**
 * Get current applied schema version from _schema_meta table.
 */
export function getCurrentVersion(storage: SqliteStorage): number {
  ensureSchemaMetaTable(storage);

  const row = storage.queryOne<{ version: number }>(
    `SELECT MAX(version) as version FROM _schema_meta;`
  );
  return row && typeof row.version === 'number' ? row.version : 0;
}

/**
 * Apply any pending migrations in ascending order.
 */
export function runMigrations(storage: SqliteStorage): { currentVersion: number; appliedCount: number } {
  ensureSchemaMetaTable(storage);
  let currentVersion = getCurrentVersion(storage);
  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version);

  if (pending.length === 0) {
    return { currentVersion, appliedCount: 0 };
  }

  let appliedCount = 0;
  for (const migration of pending) {
    storage.transaction(() => {
      migration.up(storage);
      storage.run(
        `INSERT INTO _schema_meta (version, applied_at, description) VALUES (?, ?, ?);`,
        [migration.version, new Date().toISOString(), migration.description]
      );
    });
    currentVersion = migration.version;
    appliedCount++;
  }

  return { currentVersion, appliedCount };
}
