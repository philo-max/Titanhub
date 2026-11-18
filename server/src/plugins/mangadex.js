// MangaDex (mangadex.org) 开放 API 插件 —— Titanhub 真实漫画插件。
const API = 'https://api.mangadex.org';
const API_REQUEST = { headers: { 'User-Agent': 'Titanhub/1.0' } };

function getCoverUrl(item) {
  const relationships = item.relationships || [];
  const coverRel = relationships.find((r) => r.type === 'cover_art');
  if (coverRel && coverRel.attributes && coverRel.attributes.fileName) {
    return 'https://uploads.mangadex.org/covers/' + item.id + '/' + coverRel.attributes.fileName;
  }
  return 'https://picsum.photos/300/400?random=' + item.id;
}

function getTitle(item) {
  const tObj = item.attributes && item.attributes.title;
  if (!tObj) return '未命名';
  return tObj.en || tObj.ja || tObj['ja-ro'] || Object.values(tObj)[0] || '未命名';
}

function getDescription(item) {
  const descObj = item.attributes && item.attributes.description;
  if (!descObj) return '';
  return descObj.en || descObj.ja || Object.values(descObj)[0] || '';
}

const FEED_PAGE_LIMIT = 500;
const MAX_FEED_PAGES = 20;
const FEED_LANGUAGE_TIERS = [['zh', 'zh-hk'], ['en']];

async function fetchFeedPage(mediaId, languages, offset) {
  const languageQuery = languages.map((lang) => '&translatedLanguage[]=' + lang).join('');
  const url = API + '/manga/' + mediaId + '/feed?limit=' + FEED_PAGE_LIMIT + '&offset=' + offset + languageQuery +
              '&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive&includes[]=scanlation_group';
  const res = await fetch(url, API_REQUEST);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = null;
  }
  const details = data && Array.isArray(data.errors)
    ? data.errors.map((err) => err.detail || err.title).filter(Boolean).join('; ')
    : '';
  if (res.status < 200 || res.status >= 300) {
    throw new Error('MangaDex 章节列表请求失败：HTTP ' + res.status + (details ? ' ' + details : ''));
  }
  if (!data || data.result === 'error' || !Array.isArray(data.data)) {
    throw new Error('MangaDex 章节列表响应无效' + (details ? '：' + details : '。'));
  }
  return data;
}

async function fetchFeed(mediaId, languages) {
  const items = [];
  const seen = {};
  let offset = 0;
  for (let page = 0; page < MAX_FEED_PAGES; page++) {
    const data = await fetchFeedPage(mediaId, languages, offset);
    const list = data.data;
    let added = 0;
    for (const item of list) {
      if (item && item.id && !seen[item.id]) {
        seen[item.id] = true;
        items.push(item);
        added++;
      }
    }
    offset += list.length;
    const total = typeof data.total === 'number' ? data.total : null;
    if (list.length === 0) return items;
    if (total !== null && offset >= total) return items;
    if (total === null && list.length < FEED_PAGE_LIMIT) return items;
    if (added === 0) {
      throw new Error('MangaDex 章节分页返回重复数据，已在 offset=' + offset + ' 停止。');
    }
  }
  throw new Error('MangaDex 章节分页超过 ' + MAX_FEED_PAGES + ' 页上限。');
}

function versionKey(item) {
  const attrs = item.attributes || {};
  if (!attrs.chapter) return '';
  return (attrs.volume || '') + '|' + attrs.chapter;
}

function isReadable(item) {
  const attrs = item.attributes || {};
  if (attrs.externalUrl) return false;
  return !(typeof attrs.pages === 'number' && attrs.pages <= 0);
}

function groupName(item) {
  const group = (item.relationships || []).find((r) => r.type === 'scanlation_group');
  return group && group.attributes && group.attributes.name ? group.attributes.name : '';
}

const plugin = {
  id: 'mangadex',
  name: 'MangaDex 漫画',
  types: ['manga'],

  async search(query) {
    const url = API + '/manga?limit=20&title=' + encodeURIComponent(query) +
                '&contentRating[]=safe&contentRating[]=suggestive&includes[]=cover_art';
    const res = await fetch(url, API_REQUEST);
    const data = JSON.parse(await res.text());
    const list = data.data || [];
    return list.map((item) => ({
      id: item.id,
      title: getTitle(item),
      cover: getCoverUrl(item),
      description: getDescription(item),
    }));
  },

  async explore(type) {
    if (type !== 'manga') return [];
    // Fetch popular mangas by followedCount descending
    const url = API + '/manga?limit=12&order[followedCount]=desc' +
                '&contentRating[]=safe&contentRating[]=suggestive&includes[]=cover_art';
    const res = await fetch(url, API_REQUEST);
    const data = JSON.parse(await res.text());
    const list = data.data || [];
    return list.map((item) => ({
      id: item.id,
      title: getTitle(item),
      cover: getCoverUrl(item),
      description: getDescription(item),
      updateInfo: '人气推荐',
    }));
  },

  async getDetail(mediaId) {
    const url = API + '/manga/' + mediaId + '?includes[]=cover_art&includes[]=author';
    const res = await fetch(url, API_REQUEST);
    const data = JSON.parse(await res.text());
    const item = data.data;
    if (!item) {
      throw new Error('未找到该漫画详情。');
    }

    const relationships = item.relationships || [];
    const authorRel = relationships.find((r) => r.type === 'author');
    const authorName = authorRel && authorRel.attributes ? authorRel.attributes.name : '未知作者';

    const tags = (item.attributes && item.attributes.tags) || [];
    const genres = tags.map((t) => t.attributes && t.attributes.name && t.attributes.name.en).filter(Boolean);

    return {
      id: item.id,
      title: getTitle(item),
      cover: getCoverUrl(item),
      description: getDescription(item),
      status: item.attributes && item.attributes.status === 'ongoing' ? '连载中' : '已完结',
      author: authorName,
      genres: genres.slice(0, 6),
      lastUpdate: item.attributes && item.attributes.updatedAt ? item.attributes.updatedAt.substring(0, 10) : undefined,
    };
  },

  async getChapters(mediaId) {
    let list = [];
    for (const languages of FEED_LANGUAGE_TIERS) {
      list = (await fetchFeed(mediaId, languages)).filter(isReadable);
      if (list.length > 0) break;
    }

    const versionCounts = {};
    for (const item of list) {
      const key = versionKey(item);
      if (key) versionCounts[key] = (versionCounts[key] || 0) + 1;
    }

    return list.map((item) => {
      const attrs = item.attributes || {};
      const ch = attrs.chapter;
      const title = attrs.title;
      const key = versionKey(item);
      const versionLabel = key && versionCounts[key] > 1 ? ' [' + [groupName(item), attrs.translatedLanguage].filter(Boolean).join(' · ') + ']' : '';
      let displayTitle = '';
      if (ch && title) {
        displayTitle = '第' + ch + '话 ' + title;
      } else if (ch) {
        displayTitle = '第' + ch + '话';
      } else if (title) {
        displayTitle = title;
      } else {
        displayTitle = '单页 / Oneshot';
      }

      return {
        id: item.id,
        title: displayTitle + versionLabel,
        chapterNo: ch ? parseFloat(ch) : 0,
      };
    });
  },

  async getImages(chapterId) {
    // 1. Ask MangaDex At-Home server for the CDN base URL and token
    const url = API + '/at-home/server/' + chapterId;
    const res = await fetch(url, API_REQUEST);
    const data = JSON.parse(await res.text());
    
    const baseUrl = data.baseUrl;
    const chapterData = data.chapter || {};
    const hash = chapterData.hash;
    const files = chapterData.data || []; // original files
    
    if (!baseUrl || !hash || files.length === 0) {
      throw new Error('未获取到有效的 MangaDex CDN 图像服务器或文件列表。');
    }

    // 2. Build direct CDN URLs for each page
    return files.map((filename) => ({
      url: baseUrl + '/data/' + hash + '/' + filename,
      headers: API_REQUEST.headers,
    }));
  },
};

globalThis.plugin = plugin;
