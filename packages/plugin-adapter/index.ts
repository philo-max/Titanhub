import type { MediaType } from '@titanhub/plugin-types';

export interface KazumiRule {
  name: string;
  version?: string;
  type?: Extract<MediaType, 'anime' | 'movie'>;
  baseUrl: string;
  searchURL: string;
  searchList: string;
  searchName: string;
  searchResult: string;
  searchCover?: string;
  chapterRoads?: string;
  chapterResult?: string;
  userAgent?: string;
  referer?: string;
  useWebview?: boolean;
}

export interface AdaptedPlugin {
  id: string;
  name: string;
  version: string;
  types: MediaType[];
  code: string;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'imported-rule';
}

function assertField(rule: Record<string, unknown>, field: string): void {
  if (!rule[field] || typeof rule[field] !== 'string') {
    throw new Error(`Kazumi 规则缺少必需字段: ${field}`);
  }
}

/**
 * Converts a Kazumi JSON rule into Titanhub plugin source code.
 *
 * Selectors starting with "/" or "//" run as XPath 1.0 on the host bridge;
 * anything else runs as a CSS selector. XPath list/sub-selector pairs are
 * evaluated scoped: sub-selectors query each list item's own HTML fragment.
 * Rules relying on WebView playback sniffing (useWebview=true) cannot be converted.
 */
export function adaptKazumi(rule: KazumiRule): AdaptedPlugin {
  for (const field of [
    'name',
    'baseUrl',
    'searchURL',
    'searchList',
    'searchName',
    'searchResult',
  ]) {
    assertField(rule as unknown as Record<string, unknown>, field);
  }

  const type = rule.type === 'movie' ? 'movie' : 'anime';
  const id = `kazumi-${slugify(rule.name)}`;

  const code = `// Auto-generated from Kazumi rule "${rule.name}" by @titanhub/plugin-adapter
const RULE = ${JSON.stringify(
    {
      baseUrl: rule.baseUrl,
      searchURL: rule.searchURL,
      searchList: rule.searchList,
      searchName: rule.searchName,
      searchResult: rule.searchResult,
      searchCover: rule.searchCover || '',
      chapterRoads: rule.chapterRoads || '',
      chapterResult: rule.chapterResult || '',
      userAgent: rule.userAgent || '',
      referer: rule.referer || '',
      useWebview: rule.useWebview || false,
    },
    null,
    2
  )};

const HEADERS = {};
if (RULE.userAgent) HEADERS['User-Agent'] = RULE.userAgent;
if (RULE.referer) HEADERS['Referer'] = RULE.referer;

function absolutize(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return RULE.baseUrl.replace(/\\/$/, '') + '/' + url.replace(/^\\//, '');
}

function query(html, listSelector, subSelector) {
  if (!listSelector) return [];
  const isXPath = listSelector.startsWith('/') || listSelector.startsWith('//');
  if (isXPath) {
    const list = JSON.parse(htmlParser.select(html, listSelector) || '[]');
    if (!subSelector) return list;
    return list.map(item => {
      const sub = JSON.parse(htmlParser.select(item.html, subSelector) || '[]');
      return sub[0] || { text: '', html: '', attrs: {} };
    });
  } else {
    const selector = subSelector ? (listSelector + ' ' + subSelector) : listSelector;
    return JSON.parse(htmlParser.select(html, selector) || '[]');
  }
}

const plugin = {
  async search(queryKeyword) {
    const url = RULE.searchURL.replace(/@keyword|\\{keyword\\}/g, encodeURIComponent(queryKeyword));
    const html = await fetch(url, { headers: HEADERS }).then(r => r.text());

    const names = query(html, RULE.searchList, RULE.searchName);
    const links = query(html, RULE.searchList, RULE.searchResult);
    const covers = RULE.searchCover ? query(html, RULE.searchList, RULE.searchCover) : [];

    return names.map((n, i) => ({
      id: encodeURIComponent((links[i] && links[i].attrs && links[i].attrs.href) || String(i)),
      title: n.text || '未命名',
      cover: absolutize(covers[i] && covers[i].attrs && (covers[i].attrs.src || covers[i].attrs['data-src'])),
    }));
  },

  async getDetail(mediaId) {
    const pageUrl = absolutize(decodeURIComponent(mediaId));
    const html = await fetch(pageUrl, { headers: HEADERS }).then(r => r.text());
    return {
      id: mediaId,
      title: htmlParser.selectText(html, 'h1') || htmlParser.selectText(html, 'title') || '未命名',
      cover: '',
      description: htmlParser.selectText(html, 'meta[name="description"]') || '',
    };
  },

  async getChapters(mediaId) {
    if (!RULE.chapterRoads || !RULE.chapterResult) return [];
    const pageUrl = absolutize(decodeURIComponent(mediaId));
    const html = await fetch(pageUrl, { headers: HEADERS }).then(r => r.text());
    
    const isXPath = RULE.chapterRoads.startsWith('/') || RULE.chapterRoads.startsWith('//');
    let list = [];
    if (isXPath) {
      const roads = JSON.parse(htmlParser.select(html, RULE.chapterRoads) || '[]');
      roads.forEach(road => {
        const sub = JSON.parse(htmlParser.select(road.html, RULE.chapterResult) || '[]');
        list.push(...sub);
      });
    } else {
      list = JSON.parse(htmlParser.select(html, RULE.chapterRoads + ' ' + RULE.chapterResult) || '[]');
    }

    return list.map((item, i) => ({
      id: encodeURIComponent((item.attrs && item.attrs.href) || String(i)),
      title: item.text || ('第 ' + (i + 1) + ' 话'),
      chapterNo: i + 1,
    }));
  },

  async getVideoUrl(chapterId) {
    const pageUrl = absolutize(decodeURIComponent(chapterId));
    if (RULE.useWebview && typeof sniffVideo === 'function') {
      const sniffedUrl = await sniffVideo(pageUrl, HEADERS);
      if (sniffedUrl) {
        return [{ quality: '默认', url: sniffedUrl }];
      }
    }
    const html = await fetch(pageUrl, { headers: HEADERS }).then(r => r.text());
    const sources = JSON.parse(htmlParser.select(html, 'video source, video') || '[]');
    return sources
      .filter(s => s.attrs && s.attrs.src)
      .map(s => ({ quality: '默认', url: absolutize(s.attrs.src) }));
  }
};

globalThis.plugin = plugin;
`;

  return {
    id,
    name: rule.name,
    version: rule.version || '1.0.0',
    types: [type],
    code,
  };
}

// Minimal Venera runtime implemented on top of the Titanhub sandbox (fetch + htmlParser).
// Covers ComicSource base, Network, HtmlDocument/HtmlElement and log; UI/APP/storage are no-ops.
const VENERA_SHIM = `// ---- Venera runtime shim (Titanhub) ----
class ComicSource {
  loadData() { return null }
  loadSetting() { return null }
  saveData() {}
  deleteData() {}
  get isLogged() { return false }
}
function log(...args) { console.log(...args) }
let Convert = {};
let Network = {
  async _request(method, url, headers, data) {
    const res = await fetch(url, { method, headers: headers || {}, body: data });
    return { status: res.status, headers: {}, body: await res.text() };
  },
  get(url, headers) { return this._request('GET', url, headers) },
  post(url, headers, data) { return this._request('POST', url, headers, data) },
  put(url, headers, data) { return this._request('PUT', url, headers, data) },
  delete(url, headers) { return this._request('DELETE', url, headers) },
};
class HtmlElement {
  constructor(data) { this._d = data || {} }
  get text() { return this._d.text || '' }
  get attributes() { return this._d.attrs || {} }
  querySelector() { throw new Error('Titanhub shim 不支持元素级嵌套选择，请对文档使用组合选择器。') }
  querySelectorAll() { throw new Error('Titanhub shim 不支持元素级嵌套选择，请对文档使用组合选择器。') }
}
class HtmlDocument {
  constructor(html) { this._html = html }
  querySelectorAll(q) { return JSON.parse(htmlParser.select(this._html, q)).map(d => new HtmlElement(d)) }
  querySelector(q) { const list = this.querySelectorAll(q); return list.length > 0 ? list[0] : null }
  getElementById(id) { return this.querySelector('#' + id) }
  dispose() {}
}
// ---- end Venera shim ----`;

function veneraClassBridge(className: string): string {
  return `
const __veneraInstance = new ${className}();

function __veneraTagsToGenres(tags) {
  if (!tags) return undefined;
  const genres = [];
  if (typeof tags.entries === 'function' && !Array.isArray(tags)) {
    for (const [, values] of tags.entries()) {
      for (const t of values) genres.push(String(t));
    }
  } else if (Array.isArray(tags)) {
    for (const t of tags) genres.push(String(t));
  } else {
    for (const key in tags) {
      const values = tags[key];
      if (Array.isArray(values)) for (const t of values) genres.push(String(t));
    }
  }
  return genres.length > 0 ? genres : undefined;
}

globalThis.plugin = {
  async search(query) {
    if (!__veneraInstance.search || !__veneraInstance.search.load) return [];
    const res = await __veneraInstance.search.load(query, [], 1);
    const comics = (res && res.comics) || [];
    return comics.map(c => ({
      id: String(c.id),
      title: c.title || '未命名',
      cover: c.cover || '',
      description: c.description || c.subTitle || c.subtitle || '',
    }));
  },
  async getDetail(mediaId) {
    const d = await __veneraInstance.comic.loadInfo(mediaId);
    return {
      id: mediaId,
      title: d.title || mediaId,
      cover: d.cover || '',
      description: d.description || '',
      genres: __veneraTagsToGenres(d.tags),
      status: d.updateTime || undefined,
    };
  },
  async getChapters(mediaId) {
    const d = await __veneraInstance.comic.loadInfo(mediaId);
    const ch = d.chapters;
    if (!ch) return [{ id: mediaId + '::', title: '全一话', chapterNo: 1 }];
    const entries = (typeof ch.entries === 'function' && !Array.isArray(ch))
      ? Array.from(ch.entries())
      : Object.entries(ch);
    return entries.map(([epId, title], i) => ({
      id: mediaId + '::' + epId,
      title: typeof title === 'string' ? title : (title && title.title) || ('第 ' + (i + 1) + ' 话'),
      chapterNo: i + 1,
    }));
  },
  async getImages(chapterId) {
    const sep = chapterId.indexOf('::');
    const comicId = sep >= 0 ? chapterId.slice(0, sep) : chapterId;
    const epId = sep >= 0 ? chapterId.slice(sep + 2) : null;
    const res = await __veneraInstance.comic.loadEp(comicId, epId);
    return (res && res.images) || [];
  }
};
`;
}

/**
 * Wraps a Venera JS source into Titanhub plugin source code.
 *
 * Object-style sources are mapped by method name. Class-based sources
 * (class X extends ComicSource) run against a bundled Venera runtime shim:
 * Network maps to sandbox fetch, HtmlDocument to the host cheerio bridge.
 * Chapter ids are encoded as "comicId::epId" to fit loadEp's two-argument shape.
 * Shim limitations: no element-level nested selectors, no UI/APP/storage APIs.
 */
export function adaptVenera(
  source: string,
  meta: { id: string; name: string; version?: string }
): AdaptedPlugin {
  const classMatch = source.match(/class\s+(\w+)\s+extends\s+ComicSource/);
  if (classMatch) {
    return {
      id: meta.id,
      name: meta.name,
      version: meta.version || '1.0.0',
      types: ['manga'],
      code: `// Wrapped Venera class source "${meta.name}" by @titanhub/plugin-adapter\n${VENERA_SHIM}\n\n${source}\n${veneraClassBridge(classMatch[1])}`,
    };
  }

  const code = `// Wrapped Venera source "${meta.name}" by @titanhub/plugin-adapter
${source}

const __venera = globalThis.plugin || globalThis.source || globalThis.comicSource;
if (!__venera) {
  throw new Error('Venera source did not register a global plugin/source object.');
}

globalThis.plugin = {
  async search(query) {
    const fn = __venera.search || __venera.searchComics;
    if (!fn) return [];
    const results = await fn.call(__venera, query);
    return (results || []).map(r => ({
      id: String(r.id ?? r.comicId ?? r.url ?? ''),
      title: r.title ?? r.name ?? '未命名',
      cover: r.cover ?? r.coverUrl ?? '',
      description: r.description ?? r.subtitle ?? '',
    }));
  },
  async getDetail(mediaId) {
    const fn = __venera.getDetail || __venera.loadComicInfo;
    if (!fn) return { id: mediaId, title: mediaId, cover: '' };
    const info = await fn.call(__venera, mediaId);
    return {
      id: mediaId,
      title: info.title ?? info.name ?? mediaId,
      cover: info.cover ?? info.coverUrl ?? '',
      description: info.description ?? '',
      author: info.author ?? undefined,
      genres: info.tags ?? info.genres ?? undefined,
    };
  },
  async getChapters(mediaId) {
    const fn = __venera.getChapters || __venera.loadEp || __venera.loadChapters;
    if (!fn) return [];
    const eps = await fn.call(__venera, mediaId);
    return (eps || []).map((ep, i) => ({
      id: String(ep.id ?? ep.epId ?? i),
      title: ep.title ?? ep.name ?? ('第 ' + (i + 1) + ' 话'),
      chapterNo: i + 1,
    }));
  },
  async getImages(chapterId) {
    const fn = __venera.getImages || __venera.loadComicPages || __venera.loadImages;
    if (!fn) return [];
    const pages = await fn.call(__venera, chapterId);
    return (pages || []).map(p => (typeof p === 'string' ? p : p.url ?? ''));
  }
};
`;

  return {
    id: meta.id,
    name: meta.name,
    version: meta.version || '1.0.0',
    types: ['manga'],
    code,
  };
}
