import type { AdaptedPlugin } from './index';

export interface MangayomiMetadata {
  id: string;
  name: string;
  version?: string;
  type: 'manga' | 'novel';
  baseUrl: string;
  lang?: string;
  sourceId?: string | number;
  sourceCodeLanguage?: number;
  [key: string]: unknown;
}

const runtime = String.raw`
function __unsupported(name) { throw new Error('Mangayomi unsupported API: ' + name); }
function __absolute(value, base) {
  if (!value) return '';
  value = String(value);
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) throw new Error('Mangayomi unsupported URL scheme');
  const origin = String(base).match(/^(https?:)\/\/[^/]+/i);
  if (!origin) throw new Error('Mangayomi invalid base URL');
  if (value.startsWith('//')) return origin[1] + value;
  if (value.startsWith('/')) return origin[0] + value;
  return String(base).replace(/[^/]*$/, '') + value;
}
class MProvider { get source() { return Object.assign({}, __meta, { id: __meta.sourceId === undefined ? __meta.id : __meta.sourceId }); } }
const __preferences = Object.assign(Object.create(null), __meta.preferences || {});
class SharedPreferences {
  get(key) {
    if (!Object.prototype.hasOwnProperty.call(__preferences, key)) throw new Error('Mangayomi missing source preference: ' + key);
    return __preferences[key];
  }
  getString(key, fallback) { return Object.prototype.hasOwnProperty.call(__preferences, key) ? String(__preferences[key]) : fallback; }
  setString() { return __unsupported('persistent source preferences'); }
}
class Client {
  constructor(options) {
    if (options && Object.keys(options).length) __unsupported('Client request options');
  }
  async request(method, url, headers, body) {
    headers = Object.assign({}, headers || {});
    const options = { method, headers };
    if (body !== undefined && body !== null) {
      const contentType = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
      if (contentType && String(headers[contentType]).includes('application/json')) options.body = JSON.stringify(body);
      else if (typeof body === 'string' || Array.isArray(body)) options.body = body;
      else {
        options.body = Object.keys(body).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(body[key])).join('&');
        if (!contentType) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }
    const response = await fetch(__absolute(url, __meta.baseUrl + '/'), options);
    if (response.status >= 400) throw new Error('Mangayomi HTTP ' + response.status + ': ' + url);
    const result = { body: await response.text(), statusCode: response.status, isRedirect: response.status >= 300 && response.status < 400 };
    Object.defineProperty(result, 'headers', { get() {
      if (!response.headers) return __unsupported('HTTP response headers unavailable in host');
      if (typeof response.headers.forEach !== 'function') return response.headers;
      const values = {}; response.headers.forEach((value, key) => { values[key] = value; }); return values;
    }});
    return result;
  }
  get(url, headers) { return this.request('GET', url, headers); }
  head(url, headers) { return this.request('HEAD', url, headers); }
  post(url, headers, body) { return this.request('POST', url, headers, body); }
  put(url, headers, body) { return this.request('PUT', url, headers, body); }
  patch(url, headers, body) { return this.request('PATCH', url, headers, body); }
  delete(url, headers, body) { return this.request('DELETE', url, headers, body); }
}
class Element {
  constructor(node) { this.node = node || { text: '', html: '', attrs: {} }; }
  get text() { return this.node.text; }
  get innerHtml() { return this.node.html; }
  get outerHtml() { return __unsupported('Element.outerHtml'); }
  get children() { return __unsupported('Element.children'); }
  get parent() { return __unsupported('Element.parent'); }
  get nextElementSibling() { return __unsupported('Element.nextElementSibling'); }
  get previousElementSibling() { return __unsupported('Element.previousElementSibling'); }
  get className() { return this.attr('class'); }
  attr(key) { return this.node.attrs[key] || ''; }
  hasAttr(key) { return Object.prototype.hasOwnProperty.call(this.node.attrs, key); }
  select(selector) { return new Document(this.innerHtml).select(selector); }
  selectFirst(selector) { return this.select(selector)[0] || new Element(); }
  get getHref() { return this.attr('href') || this.selectFirst('a').attr('href'); }
  get getSrc() { return this.attr('src') || this.attr('data-src') || this.attr('data-lazy-src'); }
  get getDataSrc() { return this.attr('data-src'); }
  get getImg() { return this.getSrc || this.selectFirst('img').getSrc; }
  xpath() { return __unsupported('Element.xpath'); }
  xpathFirst() { return __unsupported('Element.xpathFirst'); }
}
class Document {
  constructor(html) { this.html = String(html || ''); }
  select(selector) {
    const result = htmlParser.select(this.html, selector);
    return (typeof result === 'string' ? JSON.parse(result) : result).map(node => new Element(node));
  }
  selectFirst(selector) { return this.select(selector)[0] || new Element(); }
  get body() { return this.selectFirst('body'); }
  get head() { return this.selectFirst('head'); }
  get documentElement() { return this.selectFirst('html'); }
  get text() { return this.documentElement.text; }
  get outerHtml() { return this.html; }
  getElementById(id) { return this.selectFirst('[id="' + String(id).replace(/"/g, '\\"') + '"]'); }
  getElementsByTagName(name) { return this.select(name); }
  getElementsByClassName(name) { return this.select('.' + name); }
  xpath() { return __unsupported('Document.xpath'); }
  xpathFirst() { return __unsupported('Document.xpathFirst'); }
}
class DOMParser { parseFromString(html) { return new Document(html); } }
function evaluateJavascriptViaWebview() { return __unsupported('evaluateJavascriptViaWebview'); }
function cryptoHandler(text, iv, key, encrypt) {
  if (encrypt) return __unsupported('cryptoHandler encryption');
  if (typeof Convert === 'undefined') return __unsupported('cryptoHandler requires Convert');
  return Convert.decodeUtf8(Convert.decryptAesCbc(text, Convert.encodeUtf8(key), Convert.encodeUtf8(iv)));
}
function encryptAESCryptoJS() { return __unsupported('encryptAESCryptoJS'); }
function decryptAESCryptoJS() { return __unsupported('decryptAESCryptoJS'); }
function decryptAESGCM() { return __unsupported('decryptAESGCM'); }
function parseEpub() { return __unsupported('parseEpub'); }
function parseEpubChapter() { return __unsupported('parseEpubChapter'); }
function unpackJs() { return __unsupported('unpackJs'); }
function unpackJsAndCombine() { return __unsupported('unpackJsAndCombine'); }
function parseDates(values, format, locale) { if (format || locale) __unsupported('parseDates custom date format/locale'); return values.map(value => { const date = Date.parse(value); if (!Number.isFinite(date)) __unsupported('parseDates custom date format'); return String(date); }); }
for (const [name, last, after] of [['substringAfter', false, true], ['substringAfterLast', true, true], ['substringBefore', false, false], ['substringBeforeLast', true, false]]) {
  String.prototype[name] = function(pattern) { const index = last ? this.lastIndexOf(pattern) : this.indexOf(pattern); return index < 0 ? String(this) : after ? this.substring(index + pattern.length) : this.substring(0, index); };
}
String.prototype.substringBetween = function(left, right) { const first = this.indexOf(left); if (first < 0) return ''; const start = first + left.length; const end = this.indexOf(right, start); return end < 0 ? '' : this.substring(start, end); };
`;

export function adaptMangayomi(sourceCode: string, meta: MangayomiMetadata): AdaptedPlugin {
  if (meta.sourceCodeLanguage !== undefined && meta.sourceCodeLanguage !== 1 || /(?:import\s+['"](?:package:|dart:)|Future<|class\s+DefaultExtension\s+implements\s+MProvider)/.test(sourceCode)) {
    throw new Error('Mangayomi Dart sources are unsupported; JavaScript required');
  }
  for (const field of ['id', 'name', 'baseUrl'] as const) {
    if (typeof meta[field] !== 'string' || !meta[field].trim()) throw new Error('Mangayomi missing metadata: ' + field);
  }
  if (!/^https?:\/\//i.test(meta.baseUrl)) throw new Error('Mangayomi invalid baseUrl');
  if (!['manga', 'novel'].includes(meta.type)) throw new Error('Mangayomi unsupported type');
  if (!/class\s+DefaultExtension\s+extends\s+MProvider\b/.test(sourceCode)) throw new Error('Mangayomi JavaScript requires DefaultExtension extends MProvider');
  const initialized = { ...meta, isManga: meta.type === 'manga', itemType: meta.type === 'manga' ? 0 : 2 };
  return {
    id: meta.id,
    name: meta.name,
    version: meta.version || '1.0.0',
    types: [meta.type],
    code: `const __meta = ${JSON.stringify(initialized)};\n${runtime}\n${sourceCode}\n` + String.raw`
const __extension = new DefaultExtension();
if (typeof __extension.getSourcePreferences === 'function') {
  let preferences;
  try { preferences = __extension.getSourcePreferences(); } catch(error) { if (!String(error.message).includes('getSourcePreferences not implemented')) throw error; }
  for (const preference of preferences || []) {
    const definition = preference.editTextPreference || preference.listPreference || preference.switchPreference || preference.multiSelectListPreference;
    if (definition && !Object.prototype.hasOwnProperty.call(__preferences, preference.key)) {
      const value = definition.value !== undefined ? definition.value : definition.values !== undefined ? definition.values : definition.entryValues && definition.valueIndex !== undefined ? definition.entryValues[definition.valueIndex] : undefined;
      if (value !== undefined) __preferences[preference.key] = value;
    }
  }
}
function __call(name, args) {
  if (typeof __extension[name] !== 'function') __unsupported(name);
  return __extension[name](...args);
}
function __decode(id) { try { return decodeURIComponent(id); } catch { return id; } }
function __input(id) { id = String(id); return id.startsWith('mangayomi-chapter:') ? __decode(id.slice('mangayomi-chapter:'.length)) : id; }
function __media(item) {
  const id = item.link ?? item.url;
  if (id === undefined || id === null || id === '') throw new Error('Mangayomi result missing link');
  return { id: String(id), title: item.name || item.title || String(id), cover: __absolute(item.imageUrl, __meta.baseUrl + '/'), description: item.description || '' };
}
async function __list(method, args) {
  const result = await __call(method, args);
  if (!result || !Array.isArray(result.list)) throw new Error('Mangayomi invalid list response');
  return result.list.map(__media);
}
async function __detail(id) {
  const result = await __call('getDetail', [__input(id)]);
  if (!result || typeof result !== 'object') throw new Error('Mangayomi invalid detail response');
  return result;
}
globalThis.plugin = {
  id: __meta.id, name: __meta.name, version: __meta.version || '1.0.0', types: [__meta.type],
  async search(query, type) { if (type && type !== __meta.type) return []; return __list('search', [query, 1, []]); },
  async explore(type) { if (type && type !== __meta.type) return []; return __list('getPopular', [1]); },
  async getDetail(id) {
    const detail = await __detail(id);
    return { id, title: detail.name || detail.title || id, cover: __absolute(detail.imageUrl, __meta.baseUrl + '/'), description: detail.description || '', author: detail.author || undefined, status: detail.status == null ? undefined : String(detail.status), genres: detail.genre || [] };
  },
  async getChapters(id) {
    const detail = await __detail(id);
    if (!Array.isArray(detail.chapters)) throw new Error('Mangayomi detail missing chapters');
    return detail.chapters.map((chapter, index) => {
      if (!chapter.url) throw new Error('Mangayomi chapter missing url');
      return { id: 'mangayomi-chapter:' + encodeURIComponent(String(chapter.url)), title: chapter.name || String(index + 1), chapterNo: index + 1 };
    });
  },
  async getImages(id) {
    if (__meta.type !== 'manga') __unsupported('getImages for novel');
    const pages = await __call('getPageList', [__input(id)]);
    if (!Array.isArray(pages)) throw new Error('Mangayomi invalid page list');
    return pages.map(page => { const url = typeof page === 'string' ? page : page.url; if (!url) throw new Error('Mangayomi page missing url'); return __absolute(url, __absolute(__input(id), __meta.baseUrl + '/')); });
  },
  async getContent(id) {
    if (__meta.type !== 'novel') __unsupported('getContent for manga');
    const content = await __call('getHtmlContent', ['', __input(id)]);
    if (typeof content !== 'string') throw new Error('Mangayomi invalid novel content');
    return content;
  }
};
`,
  };
}
