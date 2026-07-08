import { Hono } from 'hono';
import { db } from '../db/db';
import { tracking, favorites } from '../db/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { requireAuth } from '../auth/jwt';

type Env = {
  Variables: {
    userId: string;
  };
};

const sync = new Hono<Env>();

// Apply Auth Middleware to all sync routes
sync.use('*', requireAuth);

// GET: Pull remote tracking logs
sync.get('/tracking', async (c) => {
  const userId = c.get('userId');
  try {
    const list = await db.select().from(tracking).where(eq(tracking.userId, userId));
    return c.json({ success: true, tracking: list });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// POST: Push and merge tracking logs (Last-Write-Wins)
sync.post('/tracking', async (c) => {
  const userId = c.get('userId');
  try {
    const body = await c.req.json();
    const incomingLogs = body.tracking || [];
    const validLogs = incomingLogs.filter(
      (item: any) => item.mediaId && item.pluginId && item.mediaType
    );

    if (validLogs.length > 0) {
      await db
        .insert(tracking)
        .values(
          validLogs.map((item: any) => ({
            userId,
            mediaId: item.mediaId,
            pluginId: item.pluginId,
            mediaType: item.mediaType,
            chapterNo: item.chapterNo ?? 0,
            chapterId: item.chapterId ?? '',
            progress: item.progress ?? 0.0,
            status: item.status ?? 'watching',
            updatedAt: new Date(item.updatedAt ? new Date(item.updatedAt).getTime() : Date.now()),
          }))
        )
        .onConflictDoUpdate({
          target: [tracking.userId, tracking.mediaId],
          set: {
            chapterNo: sql`EXCLUDED.chapter_no`,
            chapterId: sql`EXCLUDED.chapter_id`,
            progress: sql`EXCLUDED.progress`,
            status: sql`EXCLUDED.status`,
            updatedAt: sql`EXCLUDED.updated_at`,
          },
          where: sql`EXCLUDED.updated_at > ${tracking.updatedAt}`,
        });
    }

    // Return the final merged list
    const updatedList = await db.select().from(tracking).where(eq(tracking.userId, userId));
    return c.json({ success: true, tracking: updatedList });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// GET: Pull bookmarks list
sync.get('/favorites', async (c) => {
  const userId = c.get('userId');
  try {
    const list = await db.select().from(favorites).where(eq(favorites.userId, userId));
    return c.json({ success: true, favorites: list });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// POST: Merge bookmarks list
sync.post('/favorites', async (c) => {
  const userId = c.get('userId');
  try {
    const body = await c.req.json();
    const incomingFavs = body.favorites || [];

    const toDelete: string[] = [];
    const toInsert: any[] = [];

    for (const item of incomingFavs) {
      const { mediaId, pluginId, mediaType, isDeleted } = item;
      if (!mediaId || !pluginId || !mediaType) continue;

      if (isDeleted) {
        toDelete.push(mediaId);
      } else {
        toInsert.push({
          userId,
          mediaId,
          pluginId,
          mediaType,
        });
      }
    }

    // Perform batch deletions
    if (toDelete.length > 0) {
      await db
        .delete(favorites)
        .where(and(eq(favorites.userId, userId), inArray(favorites.mediaId, toDelete)));
    }

    // Perform batch insertions
    if (toInsert.length > 0) {
      await db
        .insert(favorites)
        .values(toInsert)
        .onConflictDoNothing({
          target: [favorites.userId, favorites.mediaId],
        });
    }

    // Return the final list
    const updatedList = await db.select().from(favorites).where(eq(favorites.userId, userId));
    return c.json({ success: true, favorites: updatedList });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default sync;
