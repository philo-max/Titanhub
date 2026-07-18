const BASE_URL = (globalThis.ALIST_BASE_URL || 'http://localhost:5244').replace(/\/$/, '');
const TOKEN = globalThis.ALIST_TOKEN || '';

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};
if (TOKEN) {
  HEADERS['Authorization'] = TOKEN;
}

// Check if file is video
function isVideo(name) {
  return /\.(mp4|mkv|avi|flv|webm|m3u8)$/i.test(name);
}

// Check if file is image (for manga)
function isImage(name) {
  return /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(name);
}

// Check if file is text/novel
function isNovel(name) {
  return /\.(txt|epub)$/i.test(name);
}

const plugin = {
  id: 'alist',
  name: 'Alist 私有网盘',
  types: ['anime', 'manga', 'novel', 'movie'],

  async search(query) {
    const url = `${BASE_URL}/api/fs/search`;
    const res = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        parent_path: '/',
        keywords: query,
        page: 1,
        per_page: 50,
      }),
    }).then(r => r.json());

    if (!res || res.code !== 200 || !res.data || !res.data.content) {
      return [];
    }

    return res.data.content
      .map(item => {
        const isDir = item.is_dir;
        const name = item.name;
        
        let type = 'anime';
        if (isNovel(name)) type = 'novel';
        else if (isImage(name)) type = 'manga';
        else if (isVideo(name)) type = 'anime';
        
        const fullPath = item.path;
        return {
          id: encodeURIComponent(fullPath),
          title: name,
          cover: isDir 
            ? 'https://picsum.photos/300/400?random=folder'
            : (isNovel(name) ? 'https://picsum.photos/300/400?random=novel' : 'https://picsum.photos/300/400?random=video'),
          description: `路径: ${fullPath} · 大小: ${(item.size / (1024*1024)).toFixed(1)} MB`,
          updateInfo: isDir ? '文件夹' : '文件',
        };
      });
  },

  async explore(type) {
    const url = `${BASE_URL}/api/fs/list`;
    const res = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        path: '/',
        page: 1,
        per_page: 50,
      }),
    }).then(r => r.json());

    if (!res || res.code !== 200 || !res.data || !res.data.content) {
      return [];
    }

    return res.data.content
      .map(item => {
        const isDir = item.is_dir;
        const name = item.name;
        const fullPath = '/' + name;
        return {
          id: encodeURIComponent(fullPath),
          title: name,
          cover: isDir 
            ? 'https://picsum.photos/300/400?random=folder'
            : (isNovel(name) ? 'https://picsum.photos/300/400?random=novel' : 'https://picsum.photos/300/400?random=video'),
          description: `大小: ${(item.size / (1024*1024)).toFixed(1)} MB`,
          updateInfo: isDir ? '文件夹' : '文件',
        };
      });
  },

  async getDetail(mediaId) {
    const fullPath = decodeURIComponent(mediaId);
    const parts = fullPath.split('/');
    const title = parts[parts.length - 1] || '网盘目录';

    return {
      id: mediaId,
      title,
      cover: 'https://picsum.photos/300/400?random=alist',
      description: `网盘私有路径: ${fullPath}`,
    };
  },

  async getChapters(mediaId) {
    const fullPath = decodeURIComponent(mediaId);
    const url = `${BASE_URL}/api/fs/list`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
          path: fullPath,
          page: 1,
          per_page: 100,
        }),
      }).then(r => r.json());

      if (res && res.code === 200 && res.data && res.data.content) {
        return res.data.content
          .filter(item => !item.is_dir && (isVideo(item.name) || isImage(item.name) || isNovel(item.name)))
          .map((item, idx) => ({
            id: encodeURIComponent(fullPath + '/' + item.name),
            title: item.name,
            chapterNo: idx + 1,
          }));
      }
    } catch {}

    return [{ id: mediaId, title: '直接打开', chapterNo: 1 }];
  },

  async getVideoUrl(chapterId) {
    const fullPath = decodeURIComponent(chapterId);
    const url = `${BASE_URL}/api/fs/get`;
    const res = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        path: fullPath,
      }),
    }).then(r => r.json());

    if (res && res.code === 200 && res.data && res.data.raw_url) {
      return [{
        quality: '原码直链',
        url: res.data.raw_url,
      }];
    }
    return [];
  },

  async getImages(chapterId) {
    const fullPath = decodeURIComponent(chapterId);
    const url = `${BASE_URL}/api/fs/get`;
    const res = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        path: fullPath,
      }),
    }).then(r => r.json());

    if (res && res.code === 200 && res.data && res.data.raw_url) {
      return [res.data.raw_url];
    }
    return [];
  },

  async getContent(chapterId) {
    const fullPath = decodeURIComponent(chapterId);
    const url = `${BASE_URL}/api/fs/get`;
    const res = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        path: fullPath,
      }),
    }).then(r => r.json());

    if (res && res.code === 200 && res.data && res.data.raw_url) {
      const txt = await fetch(res.data.raw_url).then(r => r.text());
      return txt;
    }
    return '文件读取失败。';
  }
};

globalThis.plugin = plugin;
