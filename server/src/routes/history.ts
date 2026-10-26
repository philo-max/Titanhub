import { Hono } from 'hono';
import { db, isDesktopDb } from '../db/db';
import { history } from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { requireAuth } from '../auth/jwt';
import {
  getSqliteStorage,
  sqliteGetHistory,
  sqliteRecordHistory,
  sqliteClearHistory,
} from '../db/sqlite';

type Env = {
  Variables: {
    userId: string;
  };
};

const historyRoute = new Hono<Env>();

// All history endpoints require an authenticated (or local) identity
historyRoute.use('*', requireAuth);

// GET: List watch/read history, newest first (?limit=, default 200, max 500)
historyRoute.get('/', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10) || 200, 500);
  try {
    if (isDesktopDb()) {
      const storage = await getSqliteStorage();
      return c.json({ success: true, history: sqliteGetHistory(storage, userId, limit) });
    }
    const list = await db
      .select()
      .from(history)
      .where(eq(history.userId, userId))
      .orderBy(desc(history.watchedAt))
      .limit(limit);
    return c.json({ success: true, history: list });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// POST: Record or refresh one history entry (one row per user+media+chapter)
historyRoute.post('/', async (c) => {
  const userId = c.get('userId');
  try {
    const body = await c.req.json();
    if (!body.mediaId || !body.pluginId || !body.mediaType) {
      return c.json({ error: 'Missing required parameters: mediaId, pluginId, mediaType.' }, 400);
    }

    const entry = {
      mediaId: body.mediaId,
      pluginId: body.pluginId,
      mediaType: body.mediaType,
      chapterId: body.chapterId ?? '',
      chapterNo: body.chapterNo ?? 0,
      title: body.title,
      cover: body.cover,
      progress: body.progress ?? 0,
      watchedAt: body.watchedAt,
    };

    if (isDesktopDb()) {
      const storage = await getSqliteStorage();
      const list = sqliteRecordHistory(storage, userId, entry);
      return c.json({ success: true, history: list });
    }

    const watchedAt = entry.watchedAt ? new Date(entry.watchedAt) : new Date();
    await db
      .insert(history)
      .values({
        userId,
        mediaType: entry.mediaType,
        mediaId: entry.mediaId,
        pluginId: entry.pluginId,
        chapterId: entry.chapterId,
        chapterNo: entry.chapterNo,
        title: entry.title,
        cover: entry.cover,
        progress: entry.progress,
        watchedAt,
      })
      .onConflictDoUpdate({
        target: [history.userId, history.mediaId, history.chapterId],
        set: {
          chapterNo: sql`EXCLUDED.chapter_no`,
          title: sql`EXCLUDED.title`,
          cover: sql`EXCLUDED.cover`,
          progress: sql`EXCLUDED.progress`,
          watchedAt: sql`EXCLUDED.watched_at`,
        },
      });

    const list = await db
      .select()
      .from(history)
      .where(eq(history.userId, userId))
      .orderBy(desc(history.watchedAt))
      .limit(200);
    return c.json({ success: true, history: list });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// DELETE: Clear all history, or a single entry when ?id= is provided
historyRoute.delete('/', async (c) => {
  const userId = c.get('userId');
  const id = c.req.query('id');
  try {
    if (isDesktopDb()) {
      const storage = await getSqliteStorage();
      return c.json({ success: true, history: sqliteClearHistory(storage, userId, id) });
    }
    if (id) {
      await db.delete(history).where(and(eq(history.userId, userId), eq(history.id, id)));
    } else {
      await db.delete(history).where(eq(history.userId, userId));
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default historyRoute;
