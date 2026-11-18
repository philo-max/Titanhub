const API = 'https://api.mangadex.org';
const UPLOADS = 'https://uploads.mangadex.org';
const PAGE_LIMIT = 100;
const MAX_CHAPTERS = 2000;
const CONTENT_RATINGS = ['safe', 'suggestive'];
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Titanhub/1.1.0 (Android)' };

async function requestJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: HEADERS, timeout: 25 });
  } catch (e) {
    throw new Error('无法连接 MangaDex：' + (e && e.message ? e.message : String(e)));
  }

  const body = await res.text();
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('MangaDex 请求过于频繁，请稍后再试。');
    }
    let detail = '';
    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed.errors && parsed.errors.length) {
        detail = parsed.errors
          .map((err) => err.detail || err.title || '')
          .filter(Boolean)
          .join('; ');
      }
    } catch (_) {}
    throw new Error('MangaDex 返回 HTTP ' + res.status + (detail ? '：' + detail : ''));
  }

  try {
    return JSON.parse(body);
  } catch (_) {
    throw new Error('MangaDex 返回了无法解析的数据。');
  }
}

function pickLocalized(map, preferred) {
  if (!map) return '';
  const order = (preferred || []).concat(Object.keys(map));
  for (let i = 0; i < order.length; i += 1) {
    const value = map[order[i]];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getTitle(item) {
  return pickLocalized(item.attributes && item.attributes.title, ['zh', 'zh-hk', 'en', 'ja-ro', 'ja']) || '未命名';
}

function getDescription(item) {
  return pickLocalized(item.attributes && item.attributes.description, ['zh', 'zh-hk', 'en', 'ja']);
}

function getCoverUrl(item) {
  const relationships = item.relationships || [];
  const coverRel = relationships.find((r) => r.type === 'cover_art');
  const fileName = coverRel && coverRel.attributes && coverRel.attributes.fileName;
  if (!fileName) return '';
  return UPLOADS + '/covers/' + item.id + '/' + encodeURIComponent(fileName);
}

function buildQuery(params) {
  const parts = [];
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(entry)));
    } else {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
    }
  });
  return parts.join('&');
}

function toListItem(item, updateInfo) {
  const result = {
    id: item.id,
    title: getTitle(item),
    cover: getCoverUrl(item),
    description: getDescription(item),
  };
  if (updateInfo) result.updateInfo = updateInfo;
  return result;
}

function chapterNumber(attributes) {
  const raw = attributes && attributes.chapter;
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function chapterLabel(attributes) {
  const number = chapterNumber(attributes);
  const title = attributes && attributes.title ? attributes.title.trim() : '';
  if (number === null && title) return title;
  if (number === null) return '单话 / Oneshot';
  const base = '第' + (attributes.chapter || String(number)) + '话';
  return title ? base + ' ' + title : base;
}

async function fetchFeed(mediaId, languages) {
  const collected = [];
  const seen = {};
  let offset = 0;
  let total = null;

  while (collected.length < MAX_CHAPTERS) {
    const query = buildQuery({
      limit: PAGE_LIMIT,
      offset: offset,
      'translatedLanguage[]': languages,
      'order[chapter]': 'asc',
      'includes[]': 'scanlation_group',
      'contentRating[]': CONTENT_RATINGS,
    });
    const data = await requestJson(
      API + '/manga/' + encodeURIComponent(mediaId) + '/feed?' + query
    );
    const batch = (data && data.data) || [];
    if (data && typeof data.total === 'number') {
      total = data.total;
    }
    batch.forEach((item) => {
      if (!item || !item.id || seen[item.id]) return;
      seen[item.id] = true;
      collected.push(item);
    });
    if (batch.length < PAGE_LIMIT) break;
    offset += batch.length;
  }

  const remaining = total === null ? 0 : total - offset;
  if (collected.length >= MAX_CHAPTERS && remaining > 0) {
    throw new Error(
      '该作品章节数超过本地上限 ' + MAX_CHAPTERS + ' 话（服务端共 ' + total + ' 话），未完整加载。'
    );
  }

  return collected;
}

function isReadable(item) {
  const attributes = (item && item.attributes) || {};
  if (attributes.externalUrl) return false;
  return !(typeof attributes.pages === 'number' && attributes.pages <= 0);
}

const plugin = {
  id: 'mangadex',
  name: 'MangaDex 漫画',
  types: ['manga'],
  providesVideo: false,

  async search(query) {
    const keyword = (query || '').trim();
    if (!keyword) return [];

    const params = buildQuery({
      limit: 20,
      title: keyword,
      'includes[]': 'cover_art',
      'contentRating[]': CONTENT_RATINGS,
    });
    const data = await requestJson(API + '/manga?' + params);
    const list = (data && data.data) || [];
    return list.map((item) => toListItem(item));
  },

  async explore(type) {
    if (type !== 'manga') return [];
    const params = buildQuery({
      limit: 12,
      'order[followedCount]': 'desc',
      'includes[]': 'cover_art',
      'contentRating[]': CONTENT_RATINGS,
    });
    const data = await requestJson(API + '/manga?' + params);
    const list = (data && data.data) || [];
    return list.map((item) => toListItem(item, '人气推荐'));
  },

  async getDetail(mediaId) {
    const data = await requestJson(
      API + '/manga/' + encodeURIComponent(mediaId) + '?includes[]=cover_art&includes[]=author&includes[]=artist'
    );
    const item = data && data.data;
    if (!item) {
      throw new Error('未找到该漫画详情。');
    }

    const relationships = item.relationships || [];
    const authorRel = relationships.find((r) => r.type === 'author');
    const authorName = authorRel && authorRel.attributes && authorRel.attributes.name
      ? authorRel.attributes.name
      : '未知作者';

    const tags = (item.attributes && item.attributes.tags) || [];
    const genres = tags
      .map((tag) => pickLocalized(tag.attributes && tag.attributes.name, ['zh', 'zh-hk', 'en', 'ja']))
      .filter(Boolean);

    const attributes = item.attributes || {};
    return {
      id: item.id,
      title: getTitle(item),
      cover: getCoverUrl(item),
      description: getDescription(item),
      status: attributes.status === 'ongoing' ? '连载中' : '已完结',
      author: authorName,
      genres: genres.slice(0, 6),
      lastUpdate: attributes.updatedAt ? attributes.updatedAt.substring(0, 10) : undefined,
    };
  },

  async getChapters(mediaId) {
    let list = (await fetchFeed(mediaId, ['zh', 'zh-hk'])).filter(isReadable);
    if (list.length === 0) {
      list = (await fetchFeed(mediaId, ['en'])).filter(isReadable);
    }
    if (list.length === 0) {
      list = (await fetchFeed(mediaId, ['ja', 'ja-ro'])).filter(isReadable);
    }

    const chapters = list
      .map((item) => {
        const attributes = item.attributes || {};
        const number = chapterNumber(attributes);
        const volume = attributes.volume ? parseFloat(attributes.volume) : Number.NaN;
        return {
          id: item.id,
          title: chapterLabel(attributes),
          chapterNo: number === null ? 0 : Math.floor(number),
          _rawNo: number === null ? 0 : number,
          _volume: Number.isFinite(volume) ? volume : Number.MAX_SAFE_INTEGER,
        };
      });

    chapters.sort((a, b) => {
      if (a._rawNo !== b._rawNo) return a._rawNo - b._rawNo;
      return a._volume - b._volume;
    });

    return chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      chapterNo: chapter.chapterNo,
    }));
  },

  async getImages(chapterId) {
    const data = await requestJson(API + '/at-home/server/' + encodeURIComponent(chapterId));
    const baseUrl = data && data.baseUrl;
    const chapterData = (data && data.chapter) || {};
    const hash = chapterData.hash;

    let files = chapterData.data || [];
    let mode = 'data';
    if (files.length === 0 && chapterData.dataSaver && chapterData.dataSaver.length > 0) {
      files = chapterData.dataSaver;
      mode = 'data-saver';
    }

    if (!baseUrl || !hash || files.length === 0) {
      throw new Error('未获取到有效的 MangaDex 图像服务器或页面列表。');
    }

    return files.map((fileName) => baseUrl + '/' + mode + '/' + hash + '/' + fileName);
  },
};

globalThis.plugin = plugin;
