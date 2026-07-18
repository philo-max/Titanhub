const plugin = {
  id: 'cyfz',
  name: '次元方舟',
  types: ['anime'],
  providesVideo: true,

  async search(query) {
    return [{ id: 'mock-cyfz-1', title: query, cover: '', description: '次元方舟搜索结果' }];
  },
  
  async explore(type) {
    // 模拟数据：和 SSRFun/Bangumi 一起测试聚合引擎
    return [
      { id: 'frieren-cyfz', title: '葬送的芙莉莲', cover: 'https://lain.bgm.tv/pic/cover/l/5b/c2/402775_v31O5.jpg', description: '次元方舟提供的芙莉莲' },
      { id: 'jujutsu', title: '咒术回战', cover: '', description: '次元方舟提供的咒术回战' }
    ];
  },

  async getDetail(mediaId) {
    return { id: mediaId, title: '次元方舟详情', cover: '', description: '测试用描述', status: '连载中' };
  },

  async getChapters(mediaId) {
    return [
      { id: mediaId + '-1', title: '第1集', chapterNo: 1 },
    ];
  },

  async getVideoUrl(chapterId) {
    return [{ quality: '1080P', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' }];
  }
};

globalThis.plugin = plugin;
