const plugin = {
  id: 'movie-mock',
  name: 'Movie Mock Plugin',
  types: ['movie'],

  async search(query) {
    const q = query.toLowerCase();
    const all = [
      {
        id: 'movie-201',
        title: '沙丘模拟版：聚合之路',
        cover: 'https://picsum.photos/300/400?random=31',
        description: '一部用于验证 Titanhub 影视播放链路的模拟电影。',
        updateInfo: 'HD',
      },
      {
        id: 'movie-202',
        title: '星际穿越模拟版',
        cover: 'https://picsum.photos/300/400?random=32',
        description: '跨越插件沙箱与真实世界的科幻旅程。',
        updateInfo: '4K',
      },
    ];
    return all.filter(
      (m) => m.title.toLowerCase().includes(q) || '电影'.includes(q) || 'movie'.includes(q)
    );
  },

  async explore(type) {
    if (type !== 'movie') return [];
    return [
      {
        id: 'movie-201',
        title: '沙丘模拟版：聚合之路',
        cover: 'https://picsum.photos/300/400?random=31',
        description: '一部用于验证 Titanhub 影视播放链路的模拟电影。',
        updateInfo: 'HD',
      },
      {
        id: 'movie-202',
        title: '星际穿越模拟版',
        cover: 'https://picsum.photos/300/400?random=32',
        description: '跨越插件沙箱与真实世界的科幻旅程。',
        updateInfo: '4K',
      },
    ];
  },

  async getDetail(mediaId) {
    const isDune = mediaId === 'movie-201';
    return {
      id: mediaId,
      title: isDune ? '沙丘模拟版：聚合之路' : '星际穿越模拟版',
      cover: `https://picsum.photos/300/400?random=${isDune ? 31 : 32}`,
      description: isDune
        ? '一部用于验证 Titanhub 影视播放链路的模拟电影。'
        : '跨越插件沙箱与真实世界的科幻旅程。',
      status: '已上映',
      author: 'Titanhub Studio',
      genres: ['科幻', '冒险'],
      lastUpdate: '2026-07-01',
    };
  },

  async getChapters(mediaId) {
    return [{ id: 'feature', title: '正片', chapterNo: 1 }];
  },

  async getVideoUrl(chapterId) {
    return [
      {
        quality: 'SD (MP4 - High Compatibility)',
        url: 'https://www.w3schools.com/html/mov_bbb.mp4',
      },
      {
        quality: '720p (HLS Stream)',
        url: 'https://d2zihajmogu5jn.cloudfront.net/bipbop/bipbopall.m3u8',
      },
    ];
  },
};

globalThis.plugin = plugin;
