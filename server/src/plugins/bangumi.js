// Bangumi (bgm.tv) 开放 API 元数据插件 —— Titanhub 第一个真实网络插件。
// 仅提供番剧资料（搜索/详情/章节/每日放送），不提供视频播放源。
const API = 'https://api.bgmapi.com';
const HEADERS = { 'User-Agent': 'titanhub/1.1 (https://github.com/titanhub)' };

function pickCover(images) {
  if (!images) return '';
  const raw = images.common || images.large || images.medium || images.grid || '';
  if (!raw) return '';
  const normalized = raw.startsWith('http://') ? 'https://' + raw.slice(7) : raw;
  if (normalized.indexOf('://lain.bgm.tv/') > 0 || normalized.indexOf('://api.bgm.tv/') > 0) {
    return 'https://i0.wp.com/' + normalized.replace(/^https?:\/\//, '');
  }
  return normalized;
}

const plugin = {
  id: 'bangumi',
  name: 'Bangumi 番组计划',
  types: ['anime'],
  providesVideo: false,

  async search(query) {
    const raw = (query || '').trim();
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
    const res = await fetch(API + '/v0/subjects/' + mediaId, { headers: HEADERS });
    const d = JSON.parse(await res.text());
    return {
      id: mediaId,
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
    const res = await fetch(API + '/v0/episodes?subject_id=' + mediaId + '&type=0&limit=50', {
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
