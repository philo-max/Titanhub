// MangaDex (mangadex.org) 开放 API 插件 —— Titanhub 真实漫画插件。
const API = 'https://api.mangadex.org';

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

const plugin = {
  id: 'mangadex',
  name: 'MangaDex 漫画',
  types: ['manga'],

  async search(query) {
    const url = API + '/manga?limit=20&title=' + encodeURIComponent(query) +
                '&contentRating[]=safe&contentRating[]=suggestive&includes[]=cover_art';
    const res = await fetch(url);
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
    const res = await fetch(url);
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
    const res = await fetch(url);
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
    // 1. Fetch Chinese translated chapters first
    let feedUrl = API + '/manga/' + mediaId + '/feed?limit=500&translatedLanguage[]=zh&translatedLanguage[]=zh-hk&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive';
    let res = await fetch(feedUrl);
    let data = JSON.parse(await res.text());
    let list = data.data || [];

    // 2. If no Chinese translations, fallback to English chapters
    if (list.length === 0) {
      feedUrl = API + '/manga/' + mediaId + '/feed?limit=500&translatedLanguage[]=en&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive';
      res = await fetch(feedUrl);
      data = JSON.parse(await res.text());
      list = data.data || [];
    }

    return list.map((item) => {
      const attrs = item.attributes || {};
      const ch = attrs.chapter;
      const title = attrs.title;
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
        title: displayTitle,
        chapterNo: ch ? parseFloat(ch) : 0,
      };
    });
  },

  async getImages(chapterId) {
    // 1. Ask MangaDex At-Home server for the CDN base URL and token
    const url = API + '/at-home/server/' + chapterId;
    const res = await fetch(url);
    const data = JSON.parse(await res.text());
    
    const baseUrl = data.baseUrl;
    const chapterData = data.chapter || {};
    const hash = chapterData.hash;
    const files = chapterData.data || []; // original files
    
    if (!baseUrl || !hash || files.length === 0) {
      throw new Error('未获取到有效的 MangaDex CDN 图像服务器或文件列表。');
    }

    // 2. Build direct CDN URLs for each page
    return files.map((filename) => baseUrl + '/data/' + hash + '/' + filename);
  },
};

globalThis.plugin = plugin;
