const plugin = {
  id: 'bilibili-mock',
  name: 'Bilibili Mock Plugin',
  types: ['anime'],
  async search(query) {
    console.log('Searching mock Bilibili for query:', query);

    // Test sandboxed fetch network access by hitting the server's own health endpoint
    try {
      const res = await fetch('http://localhost:3001/health');
      const text = await res.text();
      console.log('Sandbox fetch test response: ' + text.substring(0, 100));
    } catch (e) {
      console.log('Sandbox fetch error (expected if network is blocked): ' + String(e));
    }

    return [
      {
        id: 'bili-101',
        title: '[Mock Bilibili] Anime matching ' + query,
        cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500',
        description: 'Mock anime returned securely from a JavaScript sandboxed engine.',
      },
    ];
  },
  async explore(type) {
    if (type !== 'anime') return [];
    return [
      {
        id: 'bili-101',
        title: '[Mock Bilibili] Sandboxed Anime Info',
        cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500',
        description: 'Mock anime returned securely from a JavaScript sandboxed engine.',
        updateInfo: '第2话',
      },
      {
        id: 'bili-102',
        title: '[Mock Bilibili] 弹幕引擎实战录',
        cover: 'https://picsum.photos/300/400?random=21',
        description: '跟随主角一起探索 144Hz GSAP ticker 驱动的弹幕世界。',
        updateInfo: '第8话',
      },
      {
        id: 'bili-103',
        title: '[Mock Bilibili] 聚合平台物语',
        cover: 'https://picsum.photos/300/400?random=22',
        description: '一个应用看遍所有 ACG 内容的宏大冒险。',
        updateInfo: '完结',
      },
    ];
  },
  async getDetail(id) {
    return {
      id: id,
      title: '[Mock Bilibili] Sandboxed Anime Info',
      cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500',
      description: 'Detailed view compiled dynamically inside WebAssembly QuickJS sandbox.',
      status: 'Ongoing',
      author: 'Bilibili Aggregators',
      genres: ['Action', 'Sci-Fi'],
    };
  },
  async getChapters(id) {
    return [
      { id: 'bili-ep1', title: 'Ep 01: Dynamic Code Evaluation', chapterNo: 1 },
      { id: 'bili-ep2', title: 'Ep 02: QuickJS Performance Test', chapterNo: 2 },
    ];
  },
  async getVideoUrl(chapterId) {
    // Return standard high-compatibility MP4 test stream from W3Schools
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
