export const VENERA_SHIM = String.raw`
if (typeof console.warn !== 'function') console.warn = (...args) => console.log(...args);
if (typeof console.info !== 'function') console.info = (...args) => console.log(...args);
const APP = Object.freeze({ locale: 'zh_CN', version: '1.0.0', platform: 'unknown', isAndroid: false, isIOS: false });
function log(...args) { console.log(...args); }
function randomInt(min, max) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw new Error('Invalid randomInt bounds');
  return min + Math.floor(Math.random() * (max - min + 1));
}
function randomDouble(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error('Invalid randomDouble bounds');
  return min + Math.random() * (max - min);
}
class Comic { constructor(data) { Object.assign(this, data); } }
class ComicDetails extends Comic {}
class Comment extends Comic {}
class Cookie extends Comic {}
class ComicSource {
  constructor() { this.__data = new Map(); this.__settings = new Map(); }
  loadData(key) { return this.__data.has(key) ? this.__data.get(key) : null; }
  saveData(key, value) { this.__data.set(key, value); }
  deleteData(key) { this.__data.delete(key); }
  loadSetting(key) {
    if (this.__settings.has(key)) return this.__settings.get(key);
    const setting = this.settings && this.settings[key];
    return setting && Object.prototype.hasOwnProperty.call(setting, 'default') ? setting.default : null;
  }
  saveSetting(key, value) { this.__settings.set(key, value); }
  get isLogged() { return false; }
}
const __veneraInitializations = new WeakMap();
function __veneraInitialize(source) {
  if (!__veneraInitializations.has(source)) {
    __veneraInitializations.set(source, Promise.resolve().then(() => typeof source.init === 'function' ? source.init() : undefined));
  }
  return __veneraInitializations.get(source);
}
function __veneraUnsupported(feature) { throw new Error('Titanhub does not support Venera ' + feature); }
const UI = new Proxy({}, { get(_target, key) { return () => __veneraUnsupported('interactive UI: ' + String(key)); } });
const Network = {
  async sendRequest(method, url, headers, data) {
    const requestHeaders = { ...((headers && headers.headers) || headers || {}) };
    let body = data;
    if (body !== null && body !== undefined && typeof body === 'object') {
      body = JSON.stringify(body);
      if (!Object.keys(requestHeaders).some(key => key.toLowerCase() === 'content-type')) requestHeaders['content-type'] = 'application/json';
    }
    const options = { method, headers: requestHeaders };
    if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') options.body = body;
    const response = await fetch(url, options);
    const responseHeaders = {};
    if (response.headers && typeof response.headers.forEach === 'function') {
      response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    } else if (response.headers) {
      for (const key of Object.keys(response.headers)) responseHeaders[key.toLowerCase()] = response.headers[key];
    }
    return { status: response.status, headers: responseHeaders, body: await response.text() };
  },
  get(url, headers) { return this.sendRequest('GET', url, headers); },
  post(url, headers, data) { return this.sendRequest('POST', url, headers, data); },
  put(url, headers, data) { return this.sendRequest('PUT', url, headers, data); },
  delete(url, headers, data) { return this.sendRequest('DELETE', url, headers, data); },
  patch(url, headers, data) { return this.sendRequest('PATCH', url, headers, data); },
  head(url, headers) { return this.sendRequest('HEAD', url, headers); },
  fetchBytes() { return __veneraUnsupported('binary HTTP responses'); },
  getCookies() { return __veneraUnsupported('Cookie management; authentication must be configured explicitly'); },
  setCookies() { return __veneraUnsupported('Cookie management; authentication must be configured explicitly'); },
  deleteCookies() { return __veneraUnsupported('Cookie management'); },
};
function __veneraEscape(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
const __veneraVoidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
function __veneraParseHtml(html) {
  const root = { type: 'document', tag: '', children: [], parent: null };
  const stack = [root];
  const tokens = String(html).match(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<\/?[a-zA-Z][^>]*>|[^<]+|</gi) || [];
  let id = 0;
  for (const token of tokens) {
    const closing = token.match(/^<\/([\w:-]+)/);
    if (closing) {
      const tag = closing[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === tag) { stack.length = index; break; }
      }
      continue;
    }
    const opening = token.match(/^<([a-zA-Z][\w:-]*)\b([^>]*?)\/?\s*>/);
    const parent = stack[stack.length - 1];
    if (!opening) {
      parent.children.push({ type: token.startsWith('<!--') ? 'comment' : 'text', value: token, parent });
      continue;
    }
    const attrs = {};
    const pattern = /([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+)))?/g;
    let attribute;
    while ((attribute = pattern.exec(opening[2])) !== null) {
      const raw = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      attrs[attribute[1].toLowerCase()] = htmlParser.selectText('<div>x' + raw.replace(/</g, '&lt;') + 'x</div>', 'div').slice(1, -1);
    }
    const node = { type: 'element', tag: opening[1].toLowerCase(), attrs, children: [], parent, id: ++id };
    parent.children.push(node);
    if (node.tag === 'script' || node.tag === 'style') {
      node.children.push({ type: 'text', value: token.slice(opening[0].length).replace(/<\/(script|style)\s*>$/i, ''), parent: node });
    } else if (!__veneraVoidTags.has(node.tag) && !/\/\s*>$/.test(opening[0])) stack.push(node);
  }
  return root;
}
function __veneraSerialize(node, marked) {
  if (node.type === 'text' || node.type === 'comment') return node.value;
  const children = node.children.map(child => __veneraSerialize(child, marked)).join('');
  if (node.type === 'document') return children;
  const attrs = Object.keys(node.attrs).map(key => ' ' + key + '="' + __veneraEscape(node.attrs[key]) + '"').join('');
  const open = '<' + node.tag + attrs + (marked ? ' data-titanhub-node="' + node.id + '"' : '') + '>';
  return open + (__veneraVoidTags.has(node.tag) ? '' : children + '</' + node.tag + '>');
}
class HtmlElement {
  constructor(node, document) { this._node = node; this._document = document; }
  _assertOpen() { if (this._document._disposed) throw new Error('HtmlDocument has been disposed'); }
  querySelectorAll(selector) {
    this._assertOpen();
    const html = this._node.children.map(node => __veneraSerialize(node, true)).join('');
    const selected = JSON.parse(htmlParser.select(html, selector) || '[]');
    return selected.map(data => {
      const node = this._document._nodes.get(Number(data.attrs && data.attrs['data-titanhub-node']));
      return node ? new HtmlElement(node, this._document) : null;
    }).filter(Boolean);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementById(id) { return this.querySelectorAll('[id]').find(element => element.id === id) || null; }
  get text() {
    this._assertOpen();
    if (this._node.type === 'comment') return '';
    if (this._node.type === 'text') return htmlParser.selectText('<div>' + this._node.value + '</div>', 'div');
    return htmlParser.selectText('<div>' + this.innerHtml + '</div>', 'div');
  }
  get attributes() { this._assertOpen(); return { ...this._node.attrs }; }
  get innerHtml() { this._assertOpen(); return this._node.children.map(node => __veneraSerialize(node, false)).join(''); }
  get innerHTML() { return this.innerHtml; }
  get outerHtml() { this._assertOpen(); return __veneraSerialize(this._node, false); }
  get outerHTML() { return this.outerHtml; }
  get html() { return this.innerHtml; }
  get children() { this._assertOpen(); return this._node.children.filter(node => node.type === 'element').map(node => new HtmlElement(node, this._document)); }
  get nodes() { this._assertOpen(); return this._node.children.map(node => new HtmlElement(node, this._document)); }
  get parent() { return this._node.parent && this._node.parent.type === 'element' ? new HtmlElement(this._node.parent, this._document) : null; }
  get localName() { return this._node.tag || ''; }
  get id() { return this.attributes.id || null; }
  get classNames() { return (this.attributes.class || '').split(/\s+/).filter(Boolean); }
  get type() { return this._node.type; }
  toElement() { return this.type === 'element' ? this : null; }
  get previousSibling() { return this._sibling(-1); }
  get nextSibling() { return this._sibling(1); }
  _sibling(direction) {
    if (!this._node.parent) return null;
    const siblings = this._node.parent.children.filter(node => node.type === 'element');
    const node = siblings[siblings.indexOf(this._node) + direction];
    return node ? new HtmlElement(node, this._document) : null;
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  remove() {
    this._assertOpen();
    const parent = this._node.parent;
    if (!parent) throw new Error('Cannot remove the document root');
    const index = parent.children.indexOf(this._node);
    if (index >= 0) parent.children.splice(index, 1);
    this._node.parent = null;
  }
}
class HtmlDocument extends HtmlElement {
  constructor(html) {
    const normalized = JSON.parse(htmlParser.select(String(html), 'html') || '[]');
    const root = __veneraParseHtml(normalized[0] ? '<html>' + normalized[0].html + '</html>' : html);
    super(root, null);
    this._document = this;
    this._disposed = false;
    this._nodes = new Map();
    const visit = node => {
      if (node.type === 'element') this._nodes.set(node.id, node);
      for (const child of node.children || []) visit(child);
    };
    visit(root);
  }
  get body() { return this.querySelector('body'); }
  get head() { return this.querySelector('head'); }
  get documentElement() { return this.querySelector('html'); }
  dispose() { this._nodes.clear(); this._disposed = true; }
}
`;
