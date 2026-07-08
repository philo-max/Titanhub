import { Hono } from 'hono';
import { createHash } from 'crypto';
import { db } from '../db/db';
import { danmaku } from '../db/schema';
import { eq, and, asc, sql } from 'drizzle-orm';
import { requireAuth } from '../auth/jwt';

type Env = {
  Variables: {
    userId: string;
  };
};

const danmakuRoutes = new Hono<Env>();

const seedComments = [
  '第一！神作预定！',
  '前方高能，弹幕护体！',
  '经费在燃烧啊啊啊！',
  '画风太美了，截图党狂喜',
  '高能来袭，3 2 1',
  '这分镜神了！',
  '打戏真燃啊！',
  '每一帧都是壁纸',
  'OP入坑，催更！',
  '好听，吹爆这个插曲',
  '神仙打架，燃起来了！',
  '细节拉满！太强了',
  '卧槽，这个转场绝了！',
  '笑死，男主也太惨了',
  '女主好可爱！！！',
  '高能预警！高能预警！',
  '这才是真正的聚合神器！',
  '吹爆 Titanhub 制作组！',
  '终于等到更新了，激动！',
  '前方核能！！！',
  '这个特效给满分',
  '爱了爱了，每日一刷',
];
const seedColors = ['#FFFFFF', '#FF3366', '#33FF66', '#33CCFF', '#FFFF33', '#FF33FF', '#FFAA00'];

// Seed an empty episode with demo comments so first-time playback isn't silent
async function seedEpisode(pluginId: string, mediaId: string, episode: string, tx: any = db) {
  const rows = Array.from({ length: 120 }, () => ({
    pluginId,
    mediaId,
    episode,
    timeOffset: parseFloat((Math.random() * 600).toFixed(1)),
    content: seedComments[Math.floor(Math.random() * seedComments.length)],
    color: seedColors[Math.floor(Math.random() * seedColors.length)],
    userHash: 'seed',
  }));
  await tx.insert(danmaku).values(rows);
}

function toClientComment(row: typeof danmaku.$inferSelect) {
  return {
    id: `danmaku-${row.id}`,
    text: row.content,
    time: row.timeOffset,
    color: row.color,
  };
}

// GET: List comments for an episode
danmakuRoutes.get('/:pluginId/:mediaId/:chapterId', async (c) => {
  const { pluginId, mediaId, chapterId } = c.req.param();
  try {
    const where = and(
      eq(danmaku.pluginId, pluginId),
      eq(danmaku.mediaId, mediaId),
      eq(danmaku.episode, chapterId)
    );

    let rows = await db
      .select()
      .from(danmaku)
      .where(where)
      .orderBy(asc(danmaku.timeOffset))
      .limit(1000);

    if (rows.length === 0) {
      await db.transaction(async (tx) => {
        // Hash the resource coordinates to a signed 64-bit bigint for pg_advisory_xact_lock
        const keyStr = `${pluginId}:${mediaId}:${chapterId}`;
        const hash = createHash('sha256').update(keyStr).digest();
        const lockKey = hash.readBigInt64BE(0);

        // Block on transaction-level advisory lock
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

        // Re-check existence inside transaction
        const recheck = await tx.select().from(danmaku).where(where).limit(1);
        if (recheck.length === 0) {
          await seedEpisode(pluginId, mediaId, chapterId, tx);
        }
      });

      rows = await db
        .select()
        .from(danmaku)
        .where(where)
        .orderBy(asc(danmaku.timeOffset))
        .limit(1000);
    }

    return c.json({ comments: rows.map(toClientComment) });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// POST: Publish a comment (requires login)
danmakuRoutes.post('/', requireAuth, async (c) => {
  try {
    const { pluginId, mediaId, chapterId, time, text, color } = await c.req.json();

    if (!pluginId || !mediaId || !chapterId || typeof time !== 'number' || !text) {
      return c.json(
        { error: 'Missing required parameters: pluginId, mediaId, chapterId, time, text.' },
        400
      );
    }
    const content = String(text).trim();
    if (!content || content.length > 100) {
      return c.json({ error: 'Comment must be 1-100 characters.' }, 400);
    }
    if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return c.json({ error: 'Color must be a hex value like #FFFFFF.' }, 400);
    }

    const userHash = createHash('sha256').update(c.get('userId')).digest('hex').slice(0, 32);

    const [inserted] = await db
      .insert(danmaku)
      .values({
        pluginId,
        mediaId,
        episode: chapterId,
        timeOffset: time,
        content,
        color: color || '#FFFFFF',
        userHash,
      })
      .returning();

    return c.json({ success: true, comment: toClientComment(inserted) });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default danmakuRoutes;
