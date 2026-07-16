import type { MediaType } from '@titanhub/plugin-types';

export interface KazumiRule {
  name: string;
  version?: string;
  type?: Extract<MediaType, 'anime' | 'movie'>;
  /** Kazumi 原生规则字段为 baseURL，早期 Titanhub 导入格式为 baseUrl，两者皆可 */
  baseUrl?: string;
  baseURL?: string;
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
  // Optional explore fields. If absent, explore() falls back to baseURL
  // and reuses searchList/searchName/searchResult selectors.
  exploreURL?: string;
  exploreList?: string;
  exploreName?: string;
  exploreResult?: string;
  exploreCover?: string;
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
 * Rules with useWebview=true resolve playback via the host sniffVideo bridge.
 */
export function adaptKazumi(rule: KazumiRule): AdaptedPlugin {
  for (const field of [
    'name',
    'searchURL',
    'searchList',
    'searchName',
    'searchResult',
  ]) {
    assertField(rule as unknown as Record<string, unknown>, field);
  }
  const baseUrl = rule.baseUrl || rule.baseURL;
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('Kazumi 规则缺少必需字段: baseUrl/baseURL');
  }

  const type = rule.type === 'movie' ? 'movie' : 'anime';
  const id = `kazumi-${slugify(rule.name)}`;

  const code = `// Auto-generated from Kazumi rule "${rule.name}" by @titanhub/plugin-adapter
const RULE = ${JSON.stringify(
    {
      baseUrl,
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
      exploreURL: rule.exploreURL || '',
      exploreList: rule.exploreList || '',
      exploreName: rule.exploreName || '',
      exploreResult: rule.exploreResult || '',
      exploreCover: rule.exploreCover || '',
    },
    null,
    2
  )};

const HEADERS = {};
if (RULE.userAgent) HEADERS['User-Agent'] = RULE.userAgent;
// Kazumi always sends the site itself as referer; some sites reject bare requests
HEADERS['Referer'] = RULE.referer || RULE.baseUrl;

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
  async explore(type) {
    // Fetch the site homepage (or custom exploreURL) and extract media items.
    // Strategy 1: Use explore-specific selectors if provided.
    // Strategy 2: Fall back to search selectors (works when site reuses template).
    // Strategy 3: Generic CMS detection — find <a> tags with detail-page hrefs
    // and extract title/cover from attributes. This catches the common pattern
    // across Chinese CMS sites (MacCMS/ThinkPHP) where the list class differs
    // between search and home pages but the link structure is the same.
    const url = RULE.exploreURL || RULE.baseUrl;
    const html = await fetch(url, { headers: HEADERS }).then(r => r.text());

    const listSel = RULE.exploreList || RULE.searchList;
    const nameSel = RULE.exploreName || RULE.searchName;
    const resultSel = RULE.exploreResult || RULE.searchResult;
    const coverSel = RULE.exploreCover || RULE.searchCover;

    // Try configured selectors first
    let names = query(html, listSel, nameSel);
    let links = query(html, listSel, resultSel);
    let covers = coverSel ? query(html, listSel, coverSel) : [];

    let results = names
      .map((n, i) => ({
        href: (links[i] && links[i].attrs && links[i].attrs.href) || '',
        title: (n.text || '').replace(/\\s+/g, ' ').trim(),
        cover: absolutize(covers[i] && covers[i].attrs && (covers[i].attrs.src || covers[i].attrs['data-src'] || covers[i].attrs['data-original'])),
      }))
      .filter(r => r.href && r.title);

    // Fallback: generic CMS detection via <a> tags with detail-page hrefs.
    // Use htmlParser to select all <a> tags, then filter by href pattern.
    if (results.length === 0) {
      const allLinks = JSON.parse(htmlParser.select(html, 'a[href]') || '[]');
      const seen = new Set();
      for (const a of allLinks) {
        const href = (a.attrs && a.attrs.href) || '';
        if (!href || seen.has(href)) continue;
        // Match common CMS detail URL patterns
        var detailRe = new RegExp('vod\\/detail|voddetail|\\/p\\/|\\/show\\/|\\/anime\\/|\\/dongman\\/|index\\.php\\/vod\\/detail');
        if (!detailRe.test(href)) continue;
        seen.add(href);
        var rawTitle = (a.attrs && a.attrs.title) || '';
        if (!rawTitle) {
          // Fallback to text content. If the text is too long (>60 chars),
          // it's likely concatenated from child elements (descriptions, labels, etc.)
          // rather than a clean title — skip these entries.
          var textContent = (a.text || '').replace(/\\s+/g, ' ').trim();
          if (textContent.length > 60) continue;
          // Strip common category prefixes
          rawTitle = textContent.replace(/^(番剧|剧场版|特摄|电影|电视剧|综艺|动漫|动画|更多)\\s*/, '');
        }
        if (!rawTitle || rawTitle === '更多') continue;
        // Extract cover from inner HTML — check data-src, data-original, then src
        // Skip placeholder images (1x1 gif data URIs commonly used for lazy loading)
        var innerHtml = a.html || '';
        var coverMatch = innerHtml.match(/data-src="([^"]+)"/i);
        if (!coverMatch) coverMatch = innerHtml.match(/data-original="([^"]+)"/i);
        if (!coverMatch) coverMatch = innerHtml.match(/src="(https?:[^"]+)"/i);
        var cover = coverMatch ? absolutize(coverMatch[1]) : '';
        results.push({ href: href, title: rawTitle, cover: cover });
      }
    }

    return results
      .map(r => ({ id: encodeURIComponent(r.href), title: r.title, cover: r.cover }));
  },

  async search(queryKeyword) {
    const url = RULE.searchURL.replace(/@keyword|\\{keyword\\}/g, encodeURIComponent(queryKeyword));
    const html = await fetch(url, { headers: HEADERS }).then(r => r.text());

    const names = query(html, RULE.searchList, RULE.searchName);
    const links = query(html, RULE.searchList, RULE.searchResult);
    const covers = RULE.searchCover ? query(html, RULE.searchList, RULE.searchCover) : [];

    // Mirror Kazumi: skip list entries whose name/link sub-selector missed
    return names
      .map((n, i) => ({
        href: (links[i] && links[i].attrs && links[i].attrs.href) || '',
        title: (n.text || '').replace(/\\s+/g, ' ').trim(),
        cover: absolutize(covers[i] && covers[i].attrs && (covers[i].attrs.src || covers[i].attrs['data-src'] || covers[i].attrs['data-original'])),
      }))
      .filter(r => r.href && r.title)
      .map(r => ({ id: encodeURIComponent(r.href), title: r.title, cover: r.cover }));
  },

  async getDetail(mediaId) {
    const pageUrl = absolutize(decodeURIComponent(mediaId));
    const html = await fetch(pageUrl, { headers: HEADERS }).then(r => r.text());
    // Try multiple strategies to extract cover image
    let cover = '';
    try {
      const ogImage = htmlParser.selectText(html, 'meta[property="og:image"]');
      if (ogImage) cover = absolutize(ogImage);
    } catch {}
    if (!cover) {
      try {
        const img = JSON.parse(htmlParser.select(html, '.detail-pic img, .pic img, img.lazy') || '[]');
        if (img[0] && img[0].attrs) {
          cover = absolutize(img[0].attrs['data-src'] || img[0].attrs['data-original'] || img[0].attrs.src || '');
        }
      } catch {}
    }
    return {
      id: mediaId,
      title: htmlParser.selectText(html, 'h1') || htmlParser.selectText(html, 'title') || '未命名',
      cover: cover,
      description: htmlParser.selectText(html, 'meta[name="description"]') || htmlParser.selectText(html, 'meta[property="og:description"]') || '',
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
      roads.forEach((road, roadIndex) => {
        const sub = JSON.parse(htmlParser.select(road.html, RULE.chapterResult) || '[]');
        const prefix = roads.length > 1 ? ('线路' + (roadIndex + 1) + '·') : '';
        sub.forEach(item => list.push({ ...item, text: prefix + (item.text || '') }));
      });
    } else {
      list = JSON.parse(htmlParser.select(html, RULE.chapterRoads + ' ' + RULE.chapterResult) || '[]');
    }

    return list
      .filter(item => item.attrs && item.attrs.href)
      .map((item, i) => ({
        id: encodeURIComponent(item.attrs.href),
        title: (item.text || '').replace(/\\s+/g, ' ').trim() || ('第 ' + (i + 1) + ' 话'),
        chapterNo: i + 1,
      }));
  },

  async getVideoUrl(chapterId) {
    const pageUrl = absolutize(decodeURIComponent(chapterId));

    // Step 1: Fetch the play page HTML first (fast, ~1-2s).
    // We need it for player_aaaa parsing anyway, and it tells us whether
    // the video URL is encrypted (redirecting to a parser page) or inline.
    const html = await fetch(pageUrl, { headers: HEADERS }).then(r => r.text());

    // Step 2: Try parsing player_aaaa from the HTML.
    // MacPlayer/CMS sites use encrypt: 0 (plain), 1 (URL-encoded), 2 (Base64+URL-encoded).
    // For encrypt > 0, the decoded URL points to an external parser page
    // that we need to sniff separately.
    let sniffTarget = pageUrl;
    const playerMatch = html.match(/player_aaaa\\s*=\\s*(\\{[\\s\\S]*?\\})\\s*<\\/script/);
    if (playerMatch) {
      try {
        const playerData = JSON.parse(playerMatch[1]);
        if (playerData.url) {
          let decodedUrl = playerData.url;
          if (playerData.encrypt === 2 && typeof atob === 'function') {
            decodedUrl = decodeURIComponent(atob(playerData.url));
          } else if (playerData.encrypt === 1) {
            decodedUrl = decodeURIComponent(playerData.url);
          }
          if (decodedUrl.startsWith('http') && decodedUrl !== pageUrl) {
            // Direct video file URL — return immediately without sniffing
            if (/\\.(m3u8|mp4|flv|webm)(?:[?#]|$)/i.test(decodedUrl)) {
              return [{ quality: '默认', url: decodedUrl }];
            }
            // Parser page URL — sniff this instead of the original page
            sniffTarget = decodedUrl;
          }
        }
      } catch (e) {
        // JSON parse or decode failed, sniff the original page
      }
    }

    // Step 3: Sniff the target page (either the original play page or the
    // decoded parser page) to capture the actual video stream URL.
    if (RULE.useWebview && typeof sniffVideo === 'function') {
      const sniffedUrl = await sniffVideo(sniffTarget, HEADERS);
      if (sniffedUrl) {
        return [{ quality: '默认', url: sniffedUrl }];
      }
    }

    // Step 4: Fallback to parsing <video> elements in the HTML
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
// ─── LNReader Runtime Shim (ported from mangayomi's LNReader adapter) ───
//
// LNReader plugins use a CommonJS-style require() system with packages like
// cheerio, htmlparser2, dayjs, @libs/fetch, etc. This shim maps those to
// Titanhub's sandbox-provided primitives (fetch + htmlParser) and provides
// the polyfills LNReader plugins expect (FormData, URLSearchParams, etc.).
const LNREADER_SHIM = `// ---- LNReader runtime shim (Titanhub) ----

// ── Polyfills ──
class FormData {
  constructor() { this.params = {}; }
  append(key, value) { this.params[key] = value; }
  toJSON() { return this.params; }
}

// ── cheerio shim (maps to Titanhub's htmlParser) ──
function load(html) {
  return {
    _html: html,
    text() {
      // Get all text content
      const results = JSON.parse(htmlParser.select(this._html, 'body') || '[]');
      return results.map(r => r.text).join(' ');
    },
    html() { return this._html; },
    find(selector) {
      const results = JSON.parse(htmlParser.select(this._html, selector) || '[]');
      return results.map(r => ({
        _html: r.html,
        _text: r.text,
        _attrs: r.attrs,
        text() { return this._text; },
        html() { return this._html; },
        attr(name) { return (this._attrs && this._attrs[name]) || ''; },
        find(subSelector) {
          const sub = JSON.parse(htmlParser.select(this._html, subSelector) || '[]');
          return sub.map(s => ({
            _html: s.html, _text: s.text, _attrs: s.attrs,
            text() { return this._text; },
            html() { return this._html; },
            attr(name) { return (this._attrs && this._attrs[name]) || ''; },
          }));
        },
        first() { return this; },
        each(fn) { fn(0, this); return this; },
      }));
    },
    first(selector) {
      if (!selector) return this;
      const result = htmlParser.selectOne(this._html, selector);
      if (!result) return null;
      const r = JSON.parse(result);
      return {
        _html: r.html, _text: r.text, _attrs: r.attrs,
        text() { return this._text; },
        html() { return this._html; },
        attr(name) { return (this._attrs && this._attrs[name]) || ''; },
      };
    },
    each(fn) {
      // cheerio .each on the root document is rarely used; no-op fallback
      return this;
    },
  };
}

// ── htmlparser2 shim ──
class Parser {
  constructor(options = {}) {
    this.options = options;
    this._html = '';
  }
  write(html) { this._html += html; }
  end() {
    // Simplified: use cheerio to parse and emit events
    if (this.options.onend) this.options.onend();
  }
}

// ── dayjs shim (minimal) ──
function dayjs(date) {
  const d = date ? new Date(date) : new Date();
  return {
    _d: d,
    format(fmt) {
      if (!fmt) return d.toISOString();
      return fmt
        .replace('YYYY', d.getFullYear())
        .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
        .replace('DD', String(d.getDate()).padStart(2, '0'))
        .replace('HH', String(d.getHours()).padStart(2, '0'))
        .replace('mm', String(d.getMinutes()).padStart(2, '0'))
        .replace('ss', String(d.getSeconds()).padStart(2, '0'));
    },
   toISOString() { return d.toISOString(); },
    unix() { return Math.floor(d.getTime() / 1000); },
  };
}
dayjs.extend = function() { return dayjs; };

// ── fetchApi (maps to sandbox fetch) ──
async function fetchApi(url, init) {
  const method = (init && init.method) || 'GET';
  const headers = (init && init.headers) || {};
  const body = init && init.body;
  const res = await fetch(url, { method, headers, body });
  return {
    status: res.status,
    ok: res.status >= 200 && res.status <= 299,
    headers: { get: (name) => null },
    async text() { return res.text(); },
    async json() { return JSON.parse(await res.text()); },
  };
}

// ── NovelStatus constants ──
const NovelStatus = {
  ONGOING: 0,
  COMPLETED: 1,
  CANCELLED: 2,
  UNKNOWN: 3,
};

// ── Helper functions ──
function isUrlAbsolute(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

function defaultCover() {
  return 'https://raw.githubusercontent.com/LNReader/lnreader-plugins/refs/heads/master/public/static/coverNotAvailable.webp';
}

// ── Filter types ──
const FilterTypes = {
  Picker: 'picker',
  Checkbox: 'checkbox',
  Switch: 'switch',
  Text: 'text',
  XCheckbox: 'xcheckbox',
};
function isPickerValue(v) { return v && v.type === FilterTypes.Picker; }
function isCheckboxValue(v) { return v && v.type === FilterTypes.CheckBox; }
function isSwitchValue(v) { return v && v.type === FilterTypes.Switch; }
function isTextValue(v) { return v && v.type === FilterTypes.Text; }
function isXCheckboxValue(v) { return v && v.type === FilterTypes.XCheckbox; }

// ── Storage shim (in-memory only, resets per sandbox invocation) ──
const storage = {
  _data: {},
  get(key) { return this._data[key] || null; },
  set(key, value) { this._data[key] = value; },
  remove(key) { delete this._data[key]; },
};

// ── require() shim ──
const module = { exports: {} };
const exports = module.exports;
function require(pkg) {
  switch (pkg) {
    case 'cheerio': return { load };
    case 'htmlparser2': return { Parser };
    case 'dayjs': return dayjs;
    case 'urlencode':
      return { encode: encodeURIComponent, decode: decodeURIComponent };
    case '@libs/fetch': return { fetchApi };
    case '@libs/novelStatus': return { NovelStatus };
    case '@libs/isAbsoluteUrl': return { isUrlAbsolute };
    case '@libs/filterInputs':
      return { FilterTypes, isPickerValue, isCheckboxValue, isSwitchValue, isTextValue, isXCheckboxValue };
    case '@libs/defaultCover': return { defaultCover };
    case '@libs/storage': return { storage };
    default:
      if (pkg.startsWith('@') ) return {};
      throw new Error('Unknown module: ' + pkg);
  }
}

// ── String extensions (ported from mangayomi JsLibs) ──
String.prototype.substringAfter = function(pattern) {
  const idx = this.indexOf(pattern);
  return idx === -1 ? this.substring(0) : this.substring(idx + pattern.length);
};
String.prototype.substringAfterLast = function(pattern) {
  return this.split(pattern).pop();
};
String.prototype.substringBefore = function(pattern) {
  const idx = this.indexOf(pattern);
  return idx === -1 ? this.substring(0) : this.substring(0, idx);
};
String.prototype.substringBeforeLast = function(pattern) {
  const idx = this.lastIndexOf(pattern);
  return idx === -1 ? this.substring(0) : this.substring(0, idx);
};

// ---- end LNReader shim ----`;

function lnreaderBridge(): string {
  return `
// ── LNReader -> Titanhub plugin bridge ──
// LNReader plugins export a class or object with methods like:
//   popularNovels(page), parseNovelAndChapters(novelUrl),
//   parseChapter(chapterUrl), searchNovels(query, page)
// We detect the exported instance and map to Titanhub's plugin interface.

const __lnr = (typeof source !== 'undefined') ? source
  : (typeof plugin !== 'undefined') ? plugin
  : (typeof extension !== 'undefined') ? extension
  : null;

if (!__lnr) {
  throw new Error('LNReader source did not register a global (source/plugin/extension).');
}

function __resolveUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return (baseUrl || '').replace(/\\/$/, '') + url;
  return (baseUrl || '').replace(/\\/$/, '') + '/' + url;
}

function __getBaseUrl() {
  if (__lnr.source && __lnr.source.site) return __lnr.source.site;
  if (__lnr.baseUrl) return __lnr.baseUrl;
  if (__lnr.source && __lnr.source.baseURL) return __lnr.source.baseURL;
  return '';
}

globalThis.plugin = {
  async search(query) {
    const fn = __lnr.searchNovels || __lnr.search;
    if (!fn) return [];
    const results = await fn.call(__lnr, query, 1);
    const baseUrl = __getBaseUrl();
    return (results || []).map(r => ({
      id: String(r.path || r.url || r.id || ''),
      title: r.name || r.title || '未命名',
      cover: __resolveUrl(r.cover || r.coverUrl, baseUrl),
      description: r.summary || r.description || '',
    }));
  },

  async explore(type) {
    if (type !== 'novel') return [];
    const fn = __lnr.popularNovels || __lnr.getPopularNovels;
    if (!fn) return [];
    const results = await fn.call(__lnr, 1);
    const baseUrl = __getBaseUrl();
    return (results || []).map(r => ({
      id: String(r.path || r.url || r.id || ''),
      title: r.name || r.title || '未命名',
      cover: __resolveUrl(r.cover || r.coverUrl, baseUrl),
      description: r.summary || r.description || '',
    }));
  },

  async getDetail(mediaId) {
    const fn = __lnr.parseNovelAndChapters || __lnr.getNovel;
    if (!fn) return { id: mediaId, title: mediaId, cover: '' };
    const novel = await fn.call(__lnr, mediaId);
    const baseUrl = __getBaseUrl();
    return {
      id: mediaId,
      title: novel.name || novel.title || mediaId,
      cover: __resolveUrl(novel.cover || novel.coverUrl, baseUrl),
      description: novel.summary || novel.description || '',
      author: novel.author || undefined,
      status: novel.status !== undefined ? String(novel.status) : undefined,
      genres: novel.genres ? (Array.isArray(novel.genres) ? novel.genels : String(novel.genres).split(/[,\\s]+/)) : undefined,
    };
  },

  async getChapters(mediaId) {
    const fn = __lnr.parseNovelAndChapters || __lnr.getNovel;
    if (!fn) return [];
    const novel = await fn.call(__lnr, mediaId);
    const chapters = novel.chapters || [];
    return chapters.map((ch, i) => ({
      id: String(ch.path || ch.url || ch.id || i),
      title: ch.name || ch.title || ('第 ' + (i + 1) + ' 章'),
      chapterNo: ch.chapterNumber || (i + 1),
    }));
  },

  async getContent(chapterId) {
    const fn = __lnr.parseChapter || __lnr.getChapter;
    if (!fn) return '';
    const content = await fn.call(__lnr, chapterId);
    // parseChapter can return a string (HTML/text) or an object with text/html
    if (typeof content === 'string') return content;
    if (content && content.text) return content.text;
    if (content && content.html) return content.html;
    return String(content || '');
  },
};
`;
}

/**
 * Wraps an LNReader JavaScript source into Titanhub plugin source code.
 *
 * LNReader is a novel reader framework with a large plugin ecosystem.
 * This adapter provides a runtime shim that maps LNReader's require()-based
 * imports (cheerio, htmlparser2, dayjs, @libs/*) to Titanhub's sandbox
 * primitives (fetch + htmlParser). The plugin's methods (popularNovels,
 * parseNovelAndChapters, parseChapter, searchNovels) are bridged to
 * Titanhub's TitanhubPlugin interface.
 */
export function adaptLNReader(
  source: string,
  meta: { id: string; name: string; version?: string }
): AdaptedPlugin {
  return {
    id: meta.id,
    name: meta.name,
    version: meta.version || '1.0.0',
    types: ['novel'],
    code: `// Wrapped LNReader source "${meta.name}" by @titanhub/plugin-adapter\n${LNREADER_SHIM}\n\n${source}\n${lnreaderBridge()}`,
  };
}

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
