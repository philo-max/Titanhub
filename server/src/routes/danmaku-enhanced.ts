import { Hono } from 'hono';
import { db } from '../db/db';
import { danmaku } from '../db/schema';
import { eq, and, sql, count } from 'drizzle-orm';

type Env = {
  Variables: {
    userId: string;
  };
};

const danmakuEnhanced = new Hono<Env>();

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * GET /stats/:pluginId/:mediaId/:chapterId
 * 返回弹幕统计数据：总数、活跃用户数、颜色分布、热力时段、高频弹幕 Top5
 */
danmakuEnhanced.get('/stats/:pluginId/:mediaId/:chapterId', async (c) => {
  const { pluginId, mediaId, chapterId } = c.req.param();
  try {
    const where = and(
      eq(danmaku.pluginId, pluginId),
      eq(danmaku.mediaId, mediaId),
      eq(danmaku.episode, chapterId)
    );

    // 总数统计
    const totalResult = await db
      .select({ total: count() })
      .from(danmaku)
      .where(where);

    const total = totalResult[0]?.total ?? 0;

    if (total === 0) {
      return c.json({
        total: 0,
        activeUsers: 0,
        hotMoments: [],
        colorDistribution: {},
        topComments: [],
      });
    }

    // 独立用户数
    const usersResult = await db.execute(sql`
      SELECT COUNT(DISTINCT user_hash) as active_users FROM danmaku
      WHERE plugin_id = ${pluginId} AND media_id = ${mediaId} AND episode = ${chapterId}
    `);
    const activeUsers = Number(usersResult.rows?.[0]?.active_users ?? 0);

    // 颜色分布
    const colorResult = await db.execute(sql`
      SELECT color, COUNT(*) as cnt FROM danmaku
      WHERE plugin_id = ${pluginId} AND media_id = ${mediaId} AND episode = ${chapterId}
      GROUP BY color ORDER BY cnt DESC LIMIT 10
    `);
    const colorDistribution = Object.fromEntries(
      (colorResult.rows || []).map((r: any) => [r.color, Number(r.cnt)])
    );

    // 热力时段检测（每30秒为一个时段，>=5条弹幕标记为"高能时刻"）
    const heatResult = await db.execute(sql`
      SELECT 
        FLOOR(time_offset / 30) * 30 as segment_start,
        COUNT(*) as density
      FROM danmaku
      WHERE plugin_id = ${pluginId} AND media_id = ${mediaId} AND episode = ${chapterId}
      GROUP BY segment_start
      HAVING COUNT(*) >= 5
      ORDER BY density DESC
      LIMIT 10
    `);
    const hotMoments = (heatResult.rows || []).map((r: any) => ({
      startTime: Number(r.segment_start),
      endTime: Number(r.segment_start) + 30,
      density: Number(r.density),
      label: `\u{1F525} \u9AD8\u80FD\u65F6\u523B ${formatTime(Number(r.segment_start))} - ${formatTime(Number(r.segment_start) + 30)}`,
    }));

    // 高频弹幕 Top5
    const topResult = await db.execute(sql`
      SELECT content, COUNT(*) as freq FROM danmaku
      WHERE plugin_id = ${pluginId} AND media_id = ${mediaId} AND episode = ${chapterId}
      GROUP BY content
      ORDER BY freq DESC
      LIMIT 5
    `);
    const topComments = (topResult.rows || []).map((r: any) => ({
      text: r.content,
      count: Number(r.freq),
    }));

    return c.json({
      total,
      activeUsers,
      hotMoments,
      colorDistribution,
      topComments,
      computedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

/**
 * GET /hotspots/:pluginId/:mediaId/:chapterId
 * 返回简化的热力标记，供前端渲染进度条热力图使用
 * 格式: [{ position: 0.0-1.0, intensity: 0-1, time: seconds }]
 */
danmakuEnhanced.get('/hotspots/:pluginId/:mediaId/:chapterId', async (c) => {
  const { pluginId, mediaId, chapterId } = c.req.param();
  try {
    const result = await db.execute(sql`
      SELECT 
        FLOOR(time_offset / 10) * 10 as segment,
        COUNT(*) as density
      FROM danmaku
      WHERE plugin_id = ${pluginId} AND media_id = ${mediaId} AND episode = ${chapterId}
      GROUP BY segment
      ORDER BY segment
    `);

    const rows = (result.rows || []) as { segment: number; density: number }[];
    const maxDensity = Math.max(...rows.map(r => Number(r.density)), 1);
    const maxTime = Math.max(...rows.map(r => Number(r.segment) + 10), 600);

    const hotspots = rows.map(r => ({
      position: Number(r.segment) / maxTime,
      intensity: Number(r.density) / maxDensity,
      time: Number(r.segment),
    }));

    return c.json({ hotspots, maxTime });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default danmakuEnhanced;
