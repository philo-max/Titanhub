// Bangumi (bgm.tv) 开放 API 元数据插件 —— Titanhub 第一个真实网络插件。
// 仅提供番剧资料（搜索/详情/章节/每日放送），不提供视频播放源。
const API = 'https://api.bgmapi.com';
const BILI_API = 'https://api.bilibili.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Titanhub/1.1.2' };

function toHttps(raw) {
  if (!raw) return '';
  return raw.startsWith('http://') ? 'https://' + raw.slice(7) : raw;
}

function pickCover(images) {
  if (!images) return '';
  const raw = images.common || images.large || images.medium || images.grid || '';
  return toHttps(raw);
}

const plugin = {
  id: 'bangumi',
  name: 'Bangumi 番组计划',
  types: ['anime'],
  providesVideo: false,

  async search(query) {
    const raw = (query || '').trim();
    if (raw.startsWith('novel-tag:')) {
      const tag = raw.slice(10).trim();
      if (!tag) return [];
      const res = await fetch(API + '/v0/search/subjects?limit=20', {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: '', filter: { type: [1], tag: [tag] }, sort: 'heat' }),
      });
      const data = JSON.parse(await res.text());
      const list = (data && data.data) || [];
      return list.map((item) => ({
        id: String(item.id),
        title: item.name_cn || item.name || '未命名',
        cover: pickCover(item.images),
        description: item.summary || '',
      }));
    }
    if (raw.startsWith('tag:')) {
      const tag = raw.slice(4).trim();
      if (!tag) return [];
      const res = await fetch(API + '/v0/search/subjects?limit=20', {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: '', filter: { type: [2], tag: [tag] }, sort: 'heat' }),
      });
      const data = JSON.parse(await res.text());
      const list = (data && data.data) || [];
      return list.map((item) => ({
        id: String(item.id),
        title: item.name_cn || item.name || '未命名',
        cover: pickCover(item.images),
        description: item.summary || '',
      }));
    }
    const res = await fetch(
      API +
        '/search/subject/' +
        encodeURIComponent(raw) +
        '?type=2&responseGroup=small&max_results=20',
      { headers: HEADERS }
    );
    const data = JSON.parse(await res.text());
    const list = (data && data.list) || [];
    return list.map((item) => ({
      id: String(item.id),
      title: item.name_cn || item.name || '未命名',
      cover: pickCover(item.images),
      description: item.summary || '',
    }));
  },

  async explore(tabOrType) {
    const key = String(tabOrType || '').trim();
    if (key === '电击文库' || key === '轻小说榜' || key === 'novel') {
      const tag = key === '电击文库' ? '电击文库' : '轻小说';
      const res = await fetch(API + '/v0/search/subjects?limit=24', {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: '', filter: { type: [1], tag: [tag] }, sort: 'heat' }),
      });
      const data = JSON.parse(await res.text());
      const list = (data && data.data) || [];
      return list.map((item) => ({
        id: String(item.id),
        title: item.name_cn || item.name || '未命名',
        cover: pickCover(item.images),
        description: item.summary || '',
        updateInfo: item.rating && item.rating.score ? '★ ' + item.rating.score : tag,
      }));
    }
    const biliOrderMap = { '热门榜': 2, '高分榜': 4, '新作榜': 0 };
    if (Object.prototype.hasOwnProperty.call(biliOrderMap, key)) {
      try {
        const bRes = await fetch(
          BILI_API +
            '/pgc/season/index/result?season_type=1&pagesize=24&type=1&sort=0&order=' +
            biliOrderMap[key],
          { headers: HEADERS }
        );
        const bJson = JSON.parse(await bRes.text());
        const bList = (bJson && bJson.data && bJson.data.list) || [];
        if (bList.length > 0) {
          return bList.map((item) => ({
            id: 'bili-' + String(item.season_id),
            title: item.title || '未命名',
            cover: toHttps(item.cover || ''),
            description: item.index_show || item.order || '',
            updateInfo: item.order || item.index_show || key,
          }));
        }
      } catch (_) {}
    }
    if (key === '每日新番' || key === 'anime' || !key) {
      try {
        const tRes = await fetch(
          BILI_API + '/pgc/web/timeline?types=1&before=1&after=0',
          { headers: HEADERS }
        );
        const tJson = JSON.parse(await tRes.text());
        const days = (tJson && tJson.result) || [];
        const todayGroup = days.find((d) => d.is_today === 1) || days[0];
        const eps = (todayGroup && todayGroup.episodes) || [];
        if (eps.length > 0) {
          return eps.slice(0, 24).map((item) => ({
            id: 'bili-' + String(item.season_id),
            title: item.title || '未命名',
            cover: toHttps(item.cover || item.square_cover || ''),
            description: item.pub_index || '',
            updateInfo: item.pub_index || '今日更新',
          }));
        }
      } catch (_) {}
    }
    const sortMap = { '热门榜': 'heat', '高分榜': 'rank', '新作榜': 'date' };
    if (sortMap[key]) {
      const res = await fetch(API + '/v0/search/subjects?limit=24', {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: '', filter: { type: [2] }, sort: sortMap[key] }),
      });
      const data = JSON.parse(await res.text());
      const list = (data && data.data) || [];
      return list.map((item) => ({
        id: String(item.id),
        title: item.name_cn || item.name || '未命名',
        cover: pickCover(item.images),
        description: item.summary || '',
        updateInfo: item.rating && item.rating.score ? '★ ' + item.rating.score : key,
      }));
    }
    if (key && key !== 'anime' && key !== '每日新番') return [];
    const res = await fetch(API + '/calendar', { headers: HEADERS });
    const weekdays = JSON.parse(await res.text());
    const today = new Date().getDay(); // 0=Sunday
    const bangumiWeekday = today === 0 ? 7 : today;
    const group = weekdays.find((w) => w.weekday && w.weekday.id === bangumiWeekday) || weekdays[0];
    const items = (group && group.items) || [];
    return items.slice(0, 24).map((item) => ({
      id: String(item.id),
      title: item.name_cn || item.name || '未命名',
      cover: pickCover(item.images),
      description: item.summary || '',
      updateInfo: item.rating && item.rating.score ? '★ ' + item.rating.score : '今日放送',
    }));
  },

  async getDetail(mediaId) {
    const rawId = String(mediaId || '');
    if (rawId.startsWith('bili-')) {
      const sid = rawId.slice(5);
      const res = await fetch(BILI_API + '/pgc/view/web/season?season_id=' + sid, { headers: HEADERS });
      const json = JSON.parse(await res.text());
      const d = (json && json.result) || {};
      return {
        id: rawId,
        title: d.title || rawId,
        cover: toHttps(d.cover || ''),
        description: d.evaluate || '',
        status: (d.new_ep && d.new_ep.desc) || undefined,
        author: (d.areas && d.areas[0] && d.areas[0].name) || undefined,
        genres: Array.isArray(d.styles) ? d.styles.slice(0, 6) : [],
        lastUpdate: (d.publish && d.publish.pub_time_show) || undefined,
      };
    }
    const res = await fetch(API + '/v0/subjects/' + rawId, { headers: HEADERS });
    const d = JSON.parse(await res.text());
    return {
      id: rawId,
      title: d.name_cn || d.name || '未命名',
      cover: pickCover(d.images),
      description: d.summary || '',
      status: d.date ? '开播: ' + d.date : undefined,
      author: (d.infobox && (d.infobox.find((i) => i.key === '导演') || {}).value) || undefined,
      genres: (d.tags || []).slice(0, 6).map((t) => t.name),
      lastUpdate: d.date || undefined,
    };
  },

  async getChapters(mediaId) {
    const rawId = String(mediaId || '');
    if (rawId.startsWith('bili-')) {
      const sid = rawId.slice(5);
      const res = await fetch(BILI_API + '/pgc/view/web/season?season_id=' + sid, { headers: HEADERS });
      const json = JSON.parse(await res.text());
      const eps = (json && json.result && json.result.episodes) || [];
      return eps.slice(0, 60).map((ep, idx) => ({
        id: String(ep.id || idx + 1),
        title: ep.long_title ? '第' + ep.title + '话 ' + ep.long_title : '第' + (ep.title || idx + 1) + '话',
        chapterNo: Number(ep.title) || idx + 1,
      }));
    }
    const res = await fetch(API + '/v0/episodes?subject_id=' + rawId + '&type=0&limit=50', {
      headers: HEADERS,
    });
    const data = JSON.parse(await res.text());
    const eps = (data && data.data) || [];
    return eps.map((ep) => ({
      id: String(ep.id),
      title:
        ep.name_cn || ep.name
          ? '第' + ep.sort + '话 ' + (ep.name_cn || ep.name)
          : '第' + ep.sort + '话',
      chapterNo: ep.sort || ep.ep || 0,
    }));
  },

  async getVideoUrl() {
    return [];
  },
};

globalThis.plugin = plugin;
