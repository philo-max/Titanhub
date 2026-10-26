import type { MediaType } from '@titanhub/plugin-types';
import { KAZUMI_API_RUNTIME, type KazumiChapterApiConfig, type KazumiSearchApiConfig } from './kazumi-api';
import { VENERA_SHIM } from './venera-runtime';
import { LNREADER_SHIM, lnreaderBridge, wrapLNReaderSource, extractLegacyLNReaderSource } from './lnreader-runtime';
export { adaptMangayomi, type MangayomiMetadata } from './mangayomi';

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
  searchMode?: 'xpath' | 'api';
  chapterMode?: 'xpath' | 'api';
  searchApiConfig?: KazumiSearchApiConfig;
  chapterApiConfig?: KazumiChapterApiConfig;
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
  const requiredFields = rule.searchMode === 'api'
    ? ['name']
    : ['name', 'searchURL', 'searchList', 'searchName', 'searchResult'];
  for (const field of requiredFields) {
    assertField(rule as unknown as Record<string, unknown>, field);
  }
  if (rule.searchMode === 'api') {
    const config = rule.searchApiConfig;
    if (!config?.request?.url || !config.listPath || !config.namePath || !config.sourcePath) {
      throw new Error('Kazumi 规则缺少必需字段: searchApiConfig');
    }
  }
  if (rule.chapterMode === 'api') {
    const config = rule.chapterApiConfig;
    if (!config?.request?.url || !['nested', 'delimited'].includes(config.format)) {
      throw new Error('Kazumi 规则缺少必需字段: chapterApiConfig');
    }
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
      searchMode: rule.searchMode || 'xpath',
      chapterMode: rule.chapterMode || 'xpath',
      searchApiConfig: rule.searchApiConfig,
      chapterApiConfig: rule.chapterApiConfig,
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
  if (url.startsWith('//')) return RULE.baseUrl.split(':')[0] + ':' + url;
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return RULE.baseUrl.match(/^https?:\\/\\/[^/]+/)[0] + url;
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

${KAZUMI_API_RUNTIME}

const plugin = {
  async explore(type) {
    if (RULE.searchMode === 'api') return apiSearch('');
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
    if (RULE.searchMode === 'api') return apiSearch(queryKeyword);
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
    if (RULE.chapterMode === 'api') return apiDetail(mediaId);
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
    if (RULE.chapterMode === 'api') return apiChapters(mediaId);
    if (!RULE.chapterRoads || !RULE.chapterResult) return [];
    const pageUrl = absolutize(decodeURIComponent(mediaId));
    const html = await fetch(pageUrl, { headers: HEADERS }).then(r => r.text());
    
    const isXPath = RULE.chapterRoads.startsWith('/') || RULE.chapterRoads.startsWith('//');
    let list = [];
    if (isXPath) {
      let roads = JSON.parse(htmlParser.select(html, RULE.chapterRoads) || '[]');
      if (!roads.length) roads = [{ html }];
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
    if (/\\.(m3u8|mp4|flv|webm)(?:[?#]|$)/i.test(pageUrl)) return [{ quality: '默认', url: pageUrl }];

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
    await __veneraInitialize(__veneraInstance);
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
    await __veneraInitialize(__veneraInstance);
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
    await __veneraInitialize(__veneraInstance);
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
    await __veneraInitialize(__veneraInstance);
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
 */


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
    code: `// Wrapped LNReader source "${meta.name}" by @titanhub/plugin-adapter\n${LNREADER_SHIM}\n\n${wrapLNReaderSource(source)}\n${lnreaderBridge()}`,
  };
}

export function upgradeLegacyLNReaderCode(code: string, meta: { id: string; name: string; version?: string }): string | null {
  const source = extractLegacyLNReaderSource(code);
  return source === null ? null : adaptLNReader(source, meta).code;
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
