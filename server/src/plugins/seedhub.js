const API = 'http://104.243.25.80';
const HEADERS = { 'User-Agent': 'titanhub/1.0 (https://github.com/titanhub)' };

const plugin = {
  id: 'seedhub',
  name: 'SeedHub 影视动漫',
  types: ['movie', 'anime'],
  providesVideo: false,

  async search(query) {
    const res = await fetch(API + '/s/' + encodeURIComponent(query) + '/', { headers: HEADERS });
    const text = await res.text();
    return this._parseList(text);
  },

  async explore(type) {
    let url = API + '/categories/1/movies/';
    if (type === 'anime') {
        url = API + '/categories/2/movies/';
    }
    const res = await fetch(url, { headers: HEADERS });
    const text = await res.text();
    return this._parseList(text);
  },

  _parseList(html) {
    const results = [];
    const coverRegex = /<div class="cover">([\s\S]*?)<\/ul>\s*<\/div>/g;
    let match;
    while ((match = coverRegex.exec(html)) !== null) {
      const block = match[1];
      
      const urlMatch = /href="([^"]+)"/.exec(block);
      const url = urlMatch ? urlMatch[1] : '';
      const id = url.replace('/movies/', '').replace(/\//g, '');
      if (!id) continue;
      
      const coverMatch = /<img[^>]*src="([^"]+)"/.exec(block);
      const cover = coverMatch ? (coverMatch[1].startsWith('http') ? coverMatch[1] : 'https://sidhub.cc' + coverMatch[1]) : '';
      
      const titleMatch = /<h2><a[^>]*>[\s\S]*?<\/a>\s*([^<]+)<\/h2>/.exec(block);
      const title = titleMatch ? titleMatch[1].trim() : '未知';
      
      const liRegex = /<li>([\s\S]*?)<\/li>/g;
      const lis = [];
      let liMatch;
      while ((liMatch = liRegex.exec(block)) !== null) {
          lis.push(liMatch[1].trim());
      }
      
      let description = '';
      let updateInfo = '';
      
      if (lis.length >= 2) {
          description = lis[1].replace(/<[^>]+>/g, '').trim();
      }
      if (lis.length >= 4) {
          const scoreMatch = /<a[^>]*>([^<]+)<\/a>/.exec(lis[3]);
          if (scoreMatch) {
              updateInfo = '豆瓣: ' + scoreMatch[1].trim();
          }
      }

      results.push({
        id,
        title,
        cover,
        description,
        updateInfo
      });
    }
    return results;
  },

  async getDetail(mediaId) {
    const res = await fetch(API + '/movies/' + mediaId + '/', { headers: HEADERS });
    const html = await res.text();
    
    const coverMatch = /<img[^>]*src="([^"]+)"[^>]*class="cover-image"/.exec(html) || /<img[^>]*src="([^"]+)"/.exec(html);
    const cover = coverMatch ? (coverMatch[1].startsWith('http') ? coverMatch[1] : 'https://sidhub.cc' + coverMatch[1]) : '';
    
    const titleMatch = /<h1>([^<]+)<\/h1>/.exec(html) || /<title>([^<]+)<\/title>/.exec(html);
    let title = titleMatch ? titleMatch[1].trim() : '未知';
    if (title.includes('|')) title = title.split('|')[0].trim();
    
    const descMatch = /<div class="summary">([\s\S]*?)<\/div>/.exec(html) || /<div class="content">([\s\S]*?)<\/div>/.exec(html);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    return {
      id: mediaId,
      title,
      cover,
      description,
      status: '完结',
    };
  },

  async getChapters(mediaId) {
    // 磁力链接或种子，暂不提供在线播放
    return [{ id: 'magnet', title: '磁力链接/资源下载', chapterNo: 1 }];
  },

  async getVideoUrl(chapterId) {
    return [];
  },
};

globalThis.plugin = plugin;
