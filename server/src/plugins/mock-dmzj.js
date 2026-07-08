const plugin = {
  // 1. Search method
  async search(query) {
    const results = [];
    const q = query.toLowerCase();
    if ('漫画'.includes(q) || 'dmzj'.includes(q) || '模拟'.includes(q)) {
      results.push({
        id: 'manga-101',
        title: '大角虫模拟漫画',
        cover: 'https://picsum.photos/300/400?random=11',
        description:
          '这是一款用于测试 WebAssembly QuickJS 隔离沙箱 Cheerio HTML 解析内核的模拟漫画作品。',
      });
    }
    if ('小说'.includes(q) || 'dmzj'.includes(q) || '群星'.includes(q)) {
      results.push({
        id: 'novel-101',
        title: '群星闪耀之模拟小说',
        cover: 'https://picsum.photos/300/400?random=12',
        description:
          '这是一款用于测试 WebAssembly QuickJS 隔离沙箱 HTML 文本选择提取器的模拟轻小说。',
      });
    }
    return results;
  },

  // Explore method: featured items per content type for the home feed
  async explore(type) {
    if (type === 'manga') {
      return [
        {
          id: 'manga-101',
          title: '大角虫模拟漫画',
          cover: 'https://picsum.photos/300/400?random=11',
          description:
            '这是一款用于测试 WebAssembly QuickJS 隔离沙箱 Cheerio HTML 解析内核的模拟漫画作品。',
          updateInfo: '第3话',
        },
      ];
    }
    if (type === 'novel') {
      return [
        {
          id: 'novel-101',
          title: '群星闪耀之模拟小说',
          cover: 'https://picsum.photos/300/400?random=12',
          description:
            '这是一款用于测试 WebAssembly QuickJS 隔离沙箱 HTML 文本选择提取器的模拟轻小说。',
          updateInfo: '已完结',
        },
      ];
    }
    return [];
  },

  // 2. Detail method: parses mock site HTML page
  async getDetail(mediaId) {
    const html = await fetch(`http://localhost:3001/mock-site/dmzj/${mediaId}`).then((r) =>
      r.text()
    );

    const title = htmlParser.selectText(html, 'h1.media-title');
    const author = htmlParser.selectText(html, 'span.author');
    const status = htmlParser.selectText(html, 'span.status');
    const description = htmlParser.selectText(html, 'p.description');
    const cover =
      mediaId === 'manga-101'
        ? 'https://picsum.photos/300/400?random=11'
        : 'https://picsum.photos/300/400?random=12';

    const genresList = JSON.parse(htmlParser.select(html, 'div.genres span.genre'));
    const genres = genresList.map((g) => g.text);

    return {
      id: mediaId,
      title: title || (mediaId === 'manga-101' ? '大角虫模拟漫画' : '群星闪耀之模拟小说'),
      cover,
      description: description || '模拟抓取及抓取测试',
      status: status || '连载中',
      author: author || '大眼萌猫',
      genres: genres.length > 0 ? genres : ['奇幻', '测试'],
      lastUpdate: '2026-07-01',
    };
  },

  // 3. Chapters method: extracts chapter anchors
  async getChapters(mediaId) {
    const html = await fetch(`http://localhost:3001/mock-site/dmzj/${mediaId}`).then((r) =>
      r.text()
    );
    const list = JSON.parse(htmlParser.select(html, 'ul.chapter-list li a'));

    return list.map((item) => ({
      id: item.attrs.href || 'chapter-1',
      title: item.text || '第一章',
      chapterNo: parseInt(item.attrs['data-no'] || '1'),
    }));
  },

  // 4. Manga getImages: parses image elements
  async getImages(chapterId) {
    const html = await fetch(
      `http://localhost:3001/mock-site/dmzj/manga-101/chapter/${chapterId}`
    ).then((r) => r.text());
    const imgList = JSON.parse(htmlParser.select(html, 'div.manga-pages img.page-img'));

    return imgList.map((item) => item.attrs.src || '');
  },

  // 5. Novel getContent: parses paragraph text blocks
  async getContent(chapterId) {
    const html = await fetch(
      `http://localhost:3001/mock-site/dmzj/novel-101/chapter/${chapterId}`
    ).then((r) => r.text());
    const pList = JSON.parse(htmlParser.select(html, 'div.novel-content p'));

    return pList.map((p) => p.text).join('\n\n');
  },
};

globalThis.plugin = plugin;
