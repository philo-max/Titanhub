import { LNREADER_LIBS } from './lnreader-libs.generated';

const DEFAULT_COVER = 'https://raw.githubusercontent.com/LNReader/lnreader-plugins/refs/heads/master/public/static/coverNotAvailable.webp';

const LNREADER_POLYFILLS = String.raw`
if (typeof globalThis.setTimeout === 'undefined') {
  var __timers = { next: 1, cancelled: {} };
  globalThis.setTimeout = function (fn) {
    var id = __timers.next++;
    var args = Array.prototype.slice.call(arguments, 2);
    Promise.resolve().then(function () { if (!__timers.cancelled[id]) fn.apply(null, args); });
    return id;
  };
  globalThis.clearTimeout = function (id) { __timers.cancelled[id] = true; };
}

if (typeof globalThis.URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = class URLSearchParams {
    constructor(init) {
      this._list = [];
      if (typeof init === 'string') {
        init.replace(/^\?/, '').split('&').forEach((pair) => {
          if (!pair) return;
          const index = pair.indexOf('=');
          const key = index < 0 ? pair : pair.slice(0, index);
          const value = index < 0 ? '' : pair.slice(index + 1);
          this._list.push([decodeURIComponent(key.replace(/\+/g, ' ')), decodeURIComponent(value.replace(/\+/g, ' '))]);
        });
      } else if (Array.isArray(init)) {
        init.forEach((entry) => this._list.push([String(entry[0]), String(entry[1])]));
      } else if (init && typeof init.forEach === 'function' && typeof init.get === 'function') {
        init.forEach((value, key) => this._list.push([key, String(value)]));
      } else if (init && typeof init === 'object') {
        Object.keys(init).forEach((key) => this._list.push([key, String(init[key])]));
      }
    }
    append(key, value) { this._list.push([String(key), String(value)]); }
    delete(key) { this._list = this._list.filter((entry) => entry[0] !== key); }
    get(key) { const found = this._list.find((entry) => entry[0] === key); return found ? found[1] : null; }
    getAll(key) { return this._list.filter((entry) => entry[0] === key).map((entry) => entry[1]); }
    has(key) { return this._list.some((entry) => entry[0] === key); }
    set(key, value) {
      const index = this._list.findIndex((entry) => entry[0] === key);
      if (index < 0) { this.append(key, value); return; }
      this._list[index][1] = String(value);
      this._list = this._list.filter((entry, position) => entry[0] !== key || position === index);
    }
    forEach(fn) { this._list.forEach((entry) => fn(entry[1], entry[0], this)); }
    keys() { return this._list.map((entry) => entry[0])[Symbol.iterator](); }
    values() { return this._list.map((entry) => entry[1])[Symbol.iterator](); }
    entries() { return this._list.map((entry) => [entry[0], entry[1]])[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
    toString() {
      const encode = (text) => encodeURIComponent(text).replace(/%20/g, '+');
      return this._list.map((entry) => encode(entry[0]) + '=' + encode(entry[1])).join('&');
    }
  };
}

if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = class URL {
    constructor(input, base) {
      let text = String(input);
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
        if (base === undefined) throw new TypeError('Invalid URL: ' + text);
        const parent = new URL(String(base));
        if (text.startsWith('//')) text = parent.protocol + text;
        else if (text.startsWith('/')) text = parent.origin + text;
        else if (text.startsWith('?')) text = parent.origin + parent.pathname + text;
        else if (text.startsWith('#')) text = parent.origin + parent.pathname + parent.search + text;
        else text = parent.origin + parent.pathname.replace(/[^/]*$/, '') + text;
      }
      const match = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^:/?#]*)(?::(\d+))?([^?#]*)(\?[^#]*)?(#.*)?$/.exec(text);
      if (!match) throw new TypeError('Invalid URL: ' + text);
      this.protocol = match[1].toLowerCase();
      this.username = match[2] || '';
      this.password = match[3] || '';
      this.hostname = match[4].toLowerCase();
      this.port = match[5] || '';
      const segments = [];
      (match[6] || '/').split('/').forEach((part, position) => {
        if (part === '..') segments.pop();
        else if (part !== '.' || position === 0) segments.push(part);
      });
      this.pathname = segments.join('/') || '/';
      this.search = match[7] && match[7] !== '?' ? match[7] : '';
      this.hash = match[8] && match[8] !== '#' ? match[8] : '';
      this.searchParams = new URLSearchParams(this.search);
    }
    get host() { return this.hostname + (this.port ? ':' + this.port : ''); }
    get origin() { return this.protocol + '//' + this.host; }
    get href() {
      const query = this.searchParams.toString();
      return this.origin + this.pathname + (query ? '?' + query : this.search) + this.hash;
    }
    toString() { return this.href; }
    toJSON() { return this.href; }
  };
}

if (typeof globalThis.Headers === 'undefined') {
  globalThis.Headers = class Headers {
    constructor(init) {
      this._map = {};
      if (init && typeof init.forEach === 'function' && !Array.isArray(init)) init.forEach((value, key) => this.set(key, value));
      else if (Array.isArray(init)) init.forEach((entry) => this.append(entry[0], entry[1]));
      else if (init && typeof init === 'object') Object.keys(init).forEach((key) => this.set(key, init[key]));
    }
    append(key, value) {
      const name = String(key).toLowerCase();
      this._map[name] = this._map[name] === undefined ? String(value) : this._map[name] + ', ' + value;
    }
    set(key, value) { this._map[String(key).toLowerCase()] = String(value); }
    get(key) { const name = String(key).toLowerCase(); return this._map[name] === undefined ? null : this._map[name]; }
    has(key) { return this._map[String(key).toLowerCase()] !== undefined; }
    delete(key) { delete this._map[String(key).toLowerCase()]; }
    forEach(fn) { Object.keys(this._map).forEach((key) => fn(this._map[key], key, this)); }
    entries() { return Object.keys(this._map).map((key) => [key, this._map[key]])[Symbol.iterator](); }
    keys() { return Object.keys(this._map)[Symbol.iterator](); }
    values() { return Object.keys(this._map).map((key) => this._map[key])[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
  };
}

if (typeof globalThis.FormData === 'undefined') {
  globalThis.FormData = class FormData {
    constructor() { this.params = {}; this._list = []; }
    append(key, value) { this.params[key] = value; this._list.push([String(key), value]); }
    set(key, value) { this.params[key] = value; this._list = this._list.filter((entry) => entry[0] !== key); this._list.push([String(key), value]); }
    get(key) { const found = this._list.find((entry) => entry[0] === key); return found ? found[1] : null; }
    has(key) { return this._list.some((entry) => entry[0] === key); }
    toJSON() { return this.params; }
  };
}

if (typeof globalThis.AbortController === 'undefined') {
  globalThis.AbortSignal = class AbortSignal {
    constructor() { this.aborted = false; this._listeners = []; }
    addEventListener(type, fn) { if (type === 'abort') this._listeners.push(fn); }
    removeEventListener(type, fn) { this._listeners = this._listeners.filter((item) => item !== fn); }
  };
  globalThis.AbortController = class AbortController {
    constructor() { this.signal = new AbortSignal(); }
    abort() { this.signal.aborted = true; this.signal._listeners.forEach((fn) => fn({ type: 'abort' })); }
  };
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class TextDecoder {
    decode(bytes) {
      if (!bytes) return '';
      const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
      let text = '';
      for (let i = 0; i < data.length;) {
        const byte = data[i++];
        if (byte < 0x80) text += String.fromCharCode(byte);
        else if (byte < 0xe0) text += String.fromCharCode(((byte & 0x1f) << 6) | (data[i++] & 0x3f));
        else if (byte < 0xf0) text += String.fromCharCode(((byte & 0x0f) << 12) | ((data[i++] & 0x3f) << 6) | (data[i++] & 0x3f));
        else {
          const point = ((byte & 0x07) << 18) | ((data[i++] & 0x3f) << 12) | ((data[i++] & 0x3f) << 6) | (data[i++] & 0x3f);
          text += String.fromCodePoint(point);
        }
      }
      return text;
    }
  };
}

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = class TextEncoder {
    encode(input) {
      const bytes = [];
      for (const char of String(input === undefined ? '' : input)) {
        const point = char.codePointAt(0);
        if (point < 0x80) bytes.push(point);
        else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
        else if (point < 0x10000) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
        else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 0x3f), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
      }
      return new Uint8Array(bytes);
    }
  };
}

if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = function (input) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const text = String(input);
    let output = '';
    for (let i = 0; i < text.length; i += 3) {
      const a = text.charCodeAt(i), b = text.charCodeAt(i + 1), c = text.charCodeAt(i + 2);
      output += chars[a >> 2] + chars[((a & 3) << 4) | ((b || 0) >> 4)]
        + (isNaN(b) ? '=' : chars[((b & 15) << 2) | ((c || 0) >> 6)]) + (isNaN(c) ? '=' : chars[c & 63]);
    }
    return output;
  };
}

if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = function (input) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const text = String(input).replace(/[=\s]+$/g, '');
    let output = '';
    let bits = 0;
    let buffer = 0;
    for (let i = 0; i < text.length; i++) {
      const index = chars.indexOf(text[i]);
      if (index < 0) throw new Error('Invalid base64 input.');
      buffer = (buffer << 6) | index;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        output += String.fromCharCode((buffer >> bits) & 0xff);
      }
    }
    return output;
  };
}

if (typeof globalThis.Intl === 'undefined') {
  globalThis.Intl = {
    DateTimeFormat: function () { return { format: (date) => new Date(date).toISOString(), resolvedOptions: () => ({ timeZone: 'UTC' }) }; },
    NumberFormat: function () { return { format: (value) => String(value) }; },
  };
}
`;

const LNREADER_RUNTIME = String.raw`
// ── @libs/* ──
const __encodeBody = (body, headers) => {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) {
    if (!headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    return body.toString();
  }
  if (body instanceof FormData) {
    if (!headers['content-type']) headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    return new URLSearchParams(body.params).toString();
  }
  if (!headers['content-type']) headers['content-type'] = 'application/json';
  return JSON.stringify(body);
};

async function fetchApi(url, init) {
  const options = init || {};
  const headers = {};
  new Headers(options.headers || {}).forEach((value, key) => { headers[key] = value; });
  const method = (options.method || 'GET').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : __encodeBody(options.body, headers);
  const response = await fetch(String(url), { method, headers, body });
  const text = await response.text();
  const status = response.status;
  const result = {
    status,
    ok: status >= 200 && status <= 299,
    statusText: '',
    url: String(url),
    headers: new Headers(),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => result,
  };
  return result;
}

async function fetchText(url, init) {
  const response = await fetchApi(url, init);
  return response.text();
}

async function fetchProto() { throw new Error('Titanhub does not support LNReader protobuf requests.'); }

const NovelStatus = {
  Unknown: 'Unknown', Ongoing: 'Ongoing', Completed: 'Completed', Licensed: 'Licensed',
  PublishingFinished: 'Publishing Finished', Cancelled: 'Cancelled', OnHiatus: 'On Hiatus',
};

const FilterTypes = {
  TextInput: 'Text', Picker: 'Picker', CheckboxGroup: 'Checkbox', Switch: 'Switch', ExcludableCheckboxGroup: 'XCheckbox',
};
const __filterKind = (kind) => (value) => !!value && value.type === kind;

function isUrlAbsolute(url) { return !!url && /^(https?:)?\/\//i.test(url); }

const defaultCover = ${JSON.stringify(DEFAULT_COVER)};

class Storage {
  constructor() { this._data = {}; }
  set(key, value) { this._data[key] = { created: new Date(), value, expires: undefined }; }
  get(key, raw) {
    const entry = this._data[key];
    if (!entry) return undefined;
    return raw ? entry : entry.value;
  }
  getAllKeys() { return Object.keys(this._data); }
  delete(key) { delete this._data[key]; }
  clearAll() { this._data = {}; }
}
const storage = new Storage();
const localStorage = new Storage();
const sessionStorage = new Storage();

// ── String helpers shared with Mangayomi-style plugins ──
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

// ── CommonJS require() ──
const __lnrModuleCache = {};
function require(pkg) {
  switch (pkg) {
    case 'cheerio': return __lnrLibs.cheerio;
    case 'htmlparser2': return __lnrLibs.htmlparser2;
    case 'dayjs': return __lnrLibs.dayjs;
    case 'urlencode': return { encode: encodeURIComponent, decode: decodeURIComponent };
    case '@libs/fetch': return { fetchApi, fetchText, fetchProto, fetchFile: async () => { throw new Error('Titanhub does not support LNReader file downloads.'); } };
    case '@libs/novelStatus': return { NovelStatus };
    case '@libs/isAbsoluteUrl': return { isUrlAbsolute };
    case '@libs/filterInputs':
      return {
        FilterTypes,
        isPickerValue: __filterKind('Picker'),
        isCheckboxValue: __filterKind('Checkbox'),
        isSwitchValue: __filterKind('Switch'),
        isTextValue: __filterKind('Text'),
        isXCheckboxValue: __filterKind('XCheckbox'),
      };
    case '@libs/defaultCover': return { defaultCover };
    case '@/types/constants': return { defaultCover, defaultCoverUri: defaultCover };
    case '@libs/storage': return { storage, localStorage, sessionStorage };
    case '@libs/aes': throw new Error('Titanhub does not support the LNReader AES library yet.');
    default:
      throw new Error('Unknown LNReader module: ' + pkg);
  }
}
`;

export const LNREADER_SHIM = `// ---- LNReader runtime shim (Titanhub) ----
${LNREADER_POLYFILLS}
${LNREADER_LIBS}
${LNREADER_RUNTIME}
// ---- end LNReader shim ----`;

export function lnreaderBridge(): string {
  return String.raw`
// ── LNReader -> Titanhub plugin bridge ──
const __lnrExports = module.exports || {};
const __lnr = __lnrExports.default || __lnrExports.plugin || (typeof __lnrExports.popularNovels === 'function' ? __lnrExports : null);
if (!__lnr) {
  throw new Error('LNReader source did not register a default plugin export.');
}

const __site = String(__lnr.site || '').replace(/\/$/, '');
const __absolute = (value) => {
  if (!value) return '';
  const text = String(value);
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith('//')) return 'https:' + text;
  return __site + (text.startsWith('/') ? '' : '/') + text;
};

const __defaultFilters = () => {
  const result = {};
  const definitions = __lnr.filters || {};
  Object.keys(definitions).forEach((key) => {
    const filter = definitions[key];
    let value = filter.value;
    if (filter.type === 'Checkbox') value = [];
    else if (filter.type === 'XCheckbox') value = { include: [], exclude: [] };
    result[key] = { type: filter.type, value };
  });
  return result;
};

const __toItem = (novel) => ({
  id: String(novel.path || ''),
  title: novel.name || '未命名',
  cover: novel.cover ? __absolute(novel.cover) : '',
  description: novel.summary || '',
});

const __loadNovel = async (mediaId) => {
  if (typeof __lnr.parseNovel !== 'function') throw new Error('LNReader plugin does not implement parseNovel.');
  const novel = await __lnr.parseNovel(mediaId);
  const chapters = (novel && novel.chapters) || [];
  const totalPages = Number(novel && novel.totalPages) || 1;
  if (totalPages > 1 && typeof __lnr.parsePage === 'function') {
    for (let page = 2; page <= Math.min(totalPages, 20); page++) {
      const next = await __lnr.parsePage(mediaId, String(page));
      chapters.push.apply(chapters, (next && next.chapters) || []);
    }
  }
  novel.chapters = chapters;
  return novel;
};

globalThis.plugin = {
  async search(query) {
    if (typeof __lnr.searchNovels !== 'function') return [];
    return ((await __lnr.searchNovels(query, 1)) || []).map(__toItem);
  },

  async explore(type) {
    if (type !== 'novel' || typeof __lnr.popularNovels !== 'function') return [];
    const options = { showLatestNovels: false, filters: __defaultFilters() };
    return ((await __lnr.popularNovels(1, options)) || []).map(__toItem);
  },

  async getDetail(mediaId) {
    const novel = await __loadNovel(mediaId);
    return {
      id: mediaId,
      title: novel.name || mediaId,
      cover: novel.cover ? __absolute(novel.cover) : '',
      description: novel.summary || '',
      author: novel.author || undefined,
      status: novel.status !== undefined ? String(novel.status) : undefined,
      genres: novel.genres ? String(novel.genres).split(/\s*,\s*/).filter(Boolean) : undefined,
    };
  },

  async getChapters(mediaId) {
    const novel = await __loadNovel(mediaId);
    return novel.chapters.map((chapter, index) => ({
      id: String(chapter.path || ''),
      title: chapter.name || ('第 ' + (index + 1) + ' 章'),
      chapterNo: Number(chapter.chapterNumber) || index + 1,
    }));
  },

  async getContent(chapterId) {
    if (typeof __lnr.parseChapter !== 'function') return '';
    const content = await __lnr.parseChapter(chapterId);
    if (typeof content === 'string') return content;
    if (content && content.text) return content.text;
    if (content && content.html) return content.html;
    return String(content || '');
  },
};
`;
}

export function wrapLNReaderSource(source: string): string {
  return `
const module = { exports: {} };
(function (exports, module, require) {
${source}
;if (!module.exports.default) {
  if (typeof source !== 'undefined') module.exports.default = source;
  else if (typeof plugin !== 'undefined') module.exports.default = plugin;
}
}).call(module.exports, module.exports, module, require);
`;
}

const LEGACY_SHIM_END = '// ---- end LNReader shim ----';
const LEGACY_BRIDGE_START = '// ── LNReader -> Titanhub plugin bridge ──';

export function extractLegacyLNReaderSource(code: string): string | null {
  if (!code.startsWith('// Wrapped LNReader source') || code.includes('__lnrLibs')) return null;
  const shimEnd = code.indexOf(LEGACY_SHIM_END);
  const bridgeStart = code.lastIndexOf(LEGACY_BRIDGE_START);
  if (shimEnd < 0 || bridgeStart < shimEnd) return null;
  return code.slice(shimEnd + LEGACY_SHIM_END.length, bridgeStart).trim();
}
