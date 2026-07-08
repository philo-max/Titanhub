import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import { eq } from 'drizzle-orm';

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error(
    '[FATAL] DATABASE_URL environment variable is missing in production environment!'
  );
}

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:password123@localhost:5432/titanhub';
export const pool = new pg.Pool({ connectionString });
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
  const rows = await db.select().from(schema.plugins);
  pluginCache.clear();
  for (const row of rows) {
    const plugin = mapToDBPlugin(row);
    pluginCache.set(plugin.id, plugin);
  }
  isCacheLoaded = true;
  console.log(`[PluginCache] Loaded ${pluginCache.size} plugins into memory.`);
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
  let savedRow: typeof schema.plugins.$inferSelect;

  if (existing) {
    // If it's a builtin plugin and version is NOT greater, skip seeding to avoid wiping user customizations on startup.
    if (plugin.isBuiltin && existing.isBuiltin && plugin.version === existing.version) {
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
        isActive: plugin.isActive,
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
}

export async function setPluginActive(id: string, isActive: boolean): Promise<DBPlugin | null> {
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
