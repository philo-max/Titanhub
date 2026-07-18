const API = 'https://www.dm5.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

const plugin = {
  id: 'dm5',
  name: '动漫岛 (DM5)',
  types: ['manga'],
  providesVideo: false,

  async search(query) {
    const res = await fetch(API + '/search?title=' + encodeURIComponent(query), { headers: HEADERS });
    const text = await res.text();
    return this._parseList(text);
  },

  async explore(type) {
    const res = await fetch(API + '/manga-list/', { headers: HEADERS });
    const text = await res.text();
    return this._parseList(text);
  },

  _parseList(html) {
    const results = [];
    try {
      // 匹配 DM5 的漫画列表项，通常为 <li> 包含 <div class="info"> 或 .title
      const items = select(html, '//li[.//p[@class="title"] or .//div[@class="info"]] | //div[contains(@class, "mh-item")]');
      for (const item of items) {
         results.push({
           id: selectAttribute(item.html, './/a', 'href')[0]?.replace(/\//g, ''),
           title: selectText(item.html, './/*[@class="title"]//a | .//p[@class="title"] | .//h2/a')[0] || '未知漫画',
           cover: selectAttribute(item.html, './/img', 'src')[0] || '',
           description: 'DM5 海量漫画库'
         });
      }
    } catch(e) {}
    return results;
  },

  async getDetail(mediaId) {
    return {
      id: mediaId,
      title: 'DM5 详情',
      cover: '',
      description: '等待 DOM 选择器适配...',
      status: '连载中'
    };
  },

  async getChapters(mediaId) {
    return [{ id: mediaId + '-ch1', title: '第1话', chapterNo: 1 }];
  },

  async getImages(chapterId) {
    return [];
  }
};

globalThis.plugin = plugin;
