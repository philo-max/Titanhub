// Bangumi (bgm.tv) 开放 API 元数据插件 —— Titanhub 第一个真实网络插件。
// 仅提供番剧资料（搜索/详情/章节/每日放送），不提供视频播放源。
const API = 'https://api.bgm.tv';
const HEADERS = { 'User-Agent': 'titanhub/1.0 (https://github.com/titanhub)' };

function pickCover(images) {
  if (!images) return '';
  return images.common || images.medium || images.large || images.grid || '';
}

const plugin = {
  id: 'bangumi',
  name: 'Bangumi 番组计划',
  types: ['anime'],

  async search(query) {
    const res = await fetch(
      API +
        '/search/subject/' +
        encodeURIComponent(query) +
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

  async explore(type) {
    if (type !== 'anime') return [];
    const res = await fetch(API + '/calendar', { headers: HEADERS });
    const weekdays = JSON.parse(await res.text());
    const today = new Date().getDay(); // 0=Sunday
    const bangumiWeekday = today === 0 ? 7 : today;
    const group = weekdays.find((w) => w.weekday && w.weekday.id === bangumiWeekday) || weekdays[0];
    const items = (group && group.items) || [];
    return items.slice(0, 12).map((item) => ({
      id: String(item.id),
      title: item.name_cn || item.name || '未命名',
      cover: pickCover(item.images),
      description: item.summary || '',
      updateInfo: '今日放送',
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
    throw new Error('Bangumi 番组计划是资讯源，不提供视频播放，请改用动漫资源插件（如 咕咕番/风车动漫）搜索后观看。');
  },
};

globalThis.plugin = plugin;
