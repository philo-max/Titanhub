const plugin = {
  id: 'ssrfun',
  name: 'SSRFun动漫',
  types: ['anime'],
  providesVideo: true,

  async search(query) {
    return [{ id: 'mock-ssrfun-1', title: query, cover: '', description: 'SSRFun搜索结果' }];
  },
  
  async explore(type) {
    // 模拟数据：使用真实动漫名测试统一聚合
    return [
      { id: 'frieren', title: '葬送的芙莉莲', cover: 'https://lain.bgm.tv/pic/cover/l/5b/c2/402775_v31O5.jpg', description: 'SSRFun提供的芙莉莲' },
      { id: 'titan', title: '进击的巨人', cover: '', description: 'SSRFun提供的巨人' }
    ];
  },

  async getDetail(mediaId) {
    return { id: mediaId, title: 'SSRFun详情', cover: '', description: '测试用描述', status: '完结' };
  },

  async getChapters(mediaId) {
    return [
      { id: mediaId + '-1', title: '第1集', chapterNo: 1 },
      { id: mediaId + '-2', title: '第2集', chapterNo: 2 }
    ];
  },

  async getVideoUrl(chapterId) {
    return [{ quality: '1080P', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' }];
  }
};

globalThis.plugin = plugin;
