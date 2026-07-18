const API = 'https://www.dilidili.wang';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

const plugin = {
  id: 'dilidili',
  name: '嘀哩嘀哩 (Dilidili)',
  types: ['anime'],
  providesVideo: true,

  async search(query) {
    // 嘀哩嘀哩有 JS 盾，建议后期使用 Titanhub 的 Webview Sniffer 来绕过抓取
    const res = await fetch(API + '/search?q=' + encodeURIComponent(query), { headers: HEADERS });
    const text = await res.text();
    return this._parseList(text);
  },

  async explore(type) {
    const res = await fetch(API + '/anime/', { headers: HEADERS });
    const text = await res.text();
    return this._parseList(text);
  },

  _parseList(html) {
    // 简单容错解析器 (DOM 结构需针对最新版进行微调)
    const results = [];
    // 使用 Sandbox 注入的全局 XPath 解析方法 select(html, xpath)
    try {
      const items = select(html, '//div[@class="anime-item"]');
      for (const item of items) {
         results.push({
           id: selectAttribute(item.html, '//a', 'href')[0]?.replace(API, ''),
           title: selectText(item.html, '//h3')[0] || '未知番剧',
           cover: selectAttribute(item.html, '//img', 'src')[0] || '',
           description: '嘀哩嘀哩在线动漫'
         });
      }
    } catch(e) {
      // 容错降级
    }
    return results;
  },

  async getDetail(mediaId) {
    return {
      id: mediaId,
      title: 'Dili 详情',
      cover: '',
      description: '等待 DOM 选择器适配...',
      status: '连载中'
    };
  },

  async getChapters(mediaId) {
    return [{ id: mediaId + '-ep1', title: '第1集', chapterNo: 1 }];
  },

  async getVideoUrl(chapterId) {
    // 触发嗅探
    return [{ quality: '1080P', url: 'https://example.com/mock.m3u8' }];
  }
};

globalThis.plugin = plugin;
