import crypto from 'node:crypto';
import type { MediaType } from '@titanhub/plugin-types';
import type { SqliteStorage } from './storage';

interface MediaViewInput {
  mediaType: MediaType;
  mediaId: string;
  pluginId: string;
  title: string;
  cover?: string;
}

export function sqliteRecordMediaView(storage: SqliteStorage, item: MediaViewInput): void {
  storage.run(`INSERT INTO media_views (id,media_type,media_id,plugin_id,title,cover,views,updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(plugin_id,media_id,media_type) DO UPDATE SET
    views=media_views.views+1,title=excluded.title,cover=excluded.cover,updated_at=excluded.updated_at`,
  [crypto.randomUUID(), item.mediaType, item.mediaId, item.pluginId, item.title, item.cover ?? null, new Date().toISOString()]);
}

export function sqliteGetMediaRanking(storage: SqliteStorage, type: MediaType | undefined, limit: number) {
  return storage.query<{ mediaId: string; pluginId: string; mediaType: MediaType; title: string; cover: string | null; views: number }>(
    `SELECT media_id AS mediaId,plugin_id AS pluginId,media_type AS mediaType,title,cover,views
     FROM media_views ${type ? 'WHERE media_type = ?' : ''}
     ORDER BY views DESC,updated_at DESC,id ASC LIMIT ?`, type ? [type, limit] : [limit]);
}
