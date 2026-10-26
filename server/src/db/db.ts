import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import { eq } from 'drizzle-orm';
import {
  getSqliteStorage,
  sqliteGetPlugins,
  sqliteSavePlugin,
  sqliteSetPluginActive,
  sqliteDeletePlugin,
} from './sqlite';

export function isDesktopDb(): boolean {
  return process.env.TITANHUB_DESKTOP === '1' || process.env.TITANHUB_USE_SQLITE === '1';
}

if (
  process.env.NODE_ENV === 'production' &&
  !process.env.DATABASE_URL &&
  !isDesktopDb()
) {
  throw new Error(
    '[FATAL] DATABASE_URL environment variable is missing in production environment!'
  );
}

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:password123@localhost:5432/titanhub';
export const pool = new pg.Pool({ connectionString });
if (isDesktopDb()) {
  pool.on('error', () => {
    // Suppress unhandled errors from dummy pg pool when running in SQLite desktop mode
  });
}
export const db = drizzle(pool, { schema });

export interface DBPlugin {
  id: string;
  identifier?: string;
  name: string;
  version: string;
  types: ('anime' | 'manga' | 'novel' | 'movie')[];
  author?: string;
  code: string;
  isBuiltin?: boolean;
  installCount?: number;
  isActive: boolean;
  createdAt?: string;
}

// Memory cache for plugins to prevent database queries on every sandbox method execution
const pluginCache = new Map<string, DBPlugin>();
let isCacheLoaded = false;

async function ensureCacheLoaded() {
  if (isCacheLoaded) return;

  if (isDesktopDb()) {
    try {
      const storage = await getSqliteStorage();
      const rows = sqliteGetPlugins(storage);
      pluginCache.clear();
      for (const plugin of rows) {
        pluginCache.set(plugin.id, plugin as DBPlugin);
      }
      isCacheLoaded = true;
      console.log(`[PluginCache] (SQLite) Loaded ${pluginCache.size} plugins into memory.`);
    } catch (err: any) {
      isCacheLoaded = true;
      console.warn('[PluginCache] SQLite unreachable; running in memory fallback mode.', err);
    }
    return;
  }

  try {
    const rows = await db.select().from(schema.plugins);
    pluginCache.clear();
    for (const row of rows) {
      const plugin = mapToDBPlugin(row);
      pluginCache.set(plugin.id, plugin);
    }
    isCacheLoaded = true;
    console.log(`[PluginCache] Loaded ${pluginCache.size} plugins into memory.`);
  } catch (err: any) {
    isCacheLoaded = true;
    console.warn('[PluginCache] Database unreachable; running in memory fallback mode.');
  }
}

// Public plugin id is the human-readable identifier column; the uuid primary key stays internal
function mapToDBPlugin(row: typeof schema.plugins.$inferSelect): DBPlugin {
  return {
    id: row.identifier,
    identifier: row.identifier,
    name: row.name,
    version: row.version || '1.0.0',
    types: (row.types ? row.types.split(',') : []) as any,
    author: row.author || undefined,
    code: row.code,
    isBuiltin: row.isBuiltin,
    installCount: row.installCount,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getPlugins(): Promise<DBPlugin[]> {
  await ensureCacheLoaded();
  return Array.from(pluginCache.values());
}

export async function getPlugin(id: string): Promise<DBPlugin | null> {
  await ensureCacheLoaded();
  return pluginCache.get(id) || null;
}

export async function savePlugin(
  plugin: Omit<DBPlugin, 'createdAt'> & { id?: string }
): Promise<DBPlugin> {
  const typesString = plugin.types ? plugin.types.join(',') : '';
  const identifier = plugin.identifier || plugin.id || 'unknown';

  const existing = await getPlugin(identifier);
  const memPlugin: DBPlugin = {
    id: identifier,
    identifier,
    name: plugin.name,
    version: plugin.version || '1.0.0',
    types: plugin.types || [],
    author: plugin.author,
    code: plugin.code,
    isBuiltin: plugin.isBuiltin,
    installCount: plugin.installCount,
    isActive:
      plugin.isBuiltin && existing?.isBuiltin
        ? existing.isActive
        : plugin.isActive !== undefined
        ? plugin.isActive
        : true,
    createdAt: new Date().toISOString(),
  };

  if (isDesktopDb()) {
    try {
      const storage = await getSqliteStorage();
      const saved = sqliteSavePlugin(storage, plugin);
      pluginCache.set(saved.id, saved as DBPlugin);
      return saved as DBPlugin;
    } catch (err) {
      console.error('[PluginCache] Failed to save plugin to SQLite:', err);
      pluginCache.set(memPlugin.id, memPlugin);
      return memPlugin;
    }
  }

  try {
    let savedRow: typeof schema.plugins.$inferSelect;

    if (existing) {
      if (
        plugin.isBuiltin &&
        existing.isBuiltin &&
        plugin.version === existing.version &&
        plugin.code === existing.code
      ) {
        return existing;
      }

      const updated = await db
        .update(schema.plugins)
        .set({
          name: plugin.name,
          version: plugin.version,
          types: typesString,
          author: plugin.author,
          code: plugin.code,
          isActive: plugin.isBuiltin && existing.isBuiltin ? existing.isActive : plugin.isActive,
          isBuiltin: plugin.isBuiltin,
          installCount: plugin.installCount,
        })
        .where(eq(schema.plugins.identifier, identifier))
        .returning();
      savedRow = updated[0];
    } else {
      const inserted = await db
        .insert(schema.plugins)
        .values({
          identifier: identifier,
          name: plugin.name,
          version: plugin.version || '1.0.0',
          types: typesString,
          author: plugin.author,
          code: plugin.code,
          isActive: plugin.isActive !== undefined ? plugin.isActive : true,
          isBuiltin: plugin.isBuiltin || false,
          installCount: plugin.installCount || 0,
        })
        .returning();
      savedRow = inserted[0];
    }

    const saved = mapToDBPlugin(savedRow);
    pluginCache.set(saved.id, saved);
    return saved;
  } catch (_err) {
    // Database unreachable; maintain in-memory plugin cache
    pluginCache.set(memPlugin.id, memPlugin);
    return memPlugin;
  }
}

export async function setPluginActive(id: string, isActive: boolean): Promise<DBPlugin | null> {
  if (isDesktopDb()) {
    const storage = await getSqliteStorage();
    const updated = sqliteSetPluginActive(storage, id, isActive);
    if (updated) {
      pluginCache.set(updated.id, updated as DBPlugin);
    }
    return updated as DBPlugin | null;
  }

  const rows = await db
    .update(schema.plugins)
    .set({ isActive })
    .where(eq(schema.plugins.identifier, id))
    .returning();
  if (rows.length === 0) return null;
  const updated = mapToDBPlugin(rows[0]);
  pluginCache.set(updated.id, updated);
  return updated;
}

export async function deletePlugin(id: string): Promise<boolean> {
  if (isDesktopDb()) {
    const storage = await getSqliteStorage();
    const ok = sqliteDeletePlugin(storage, id);
    if (ok) {
      pluginCache.delete(id);
    }
    return ok;
  }

  const result = await db
    .delete(schema.plugins)
    .where(eq(schema.plugins.identifier, id))
    .returning();
  if (result.length > 0) {
    pluginCache.delete(id);
    return true;
  }
  return false;
}

