const String veneraShimCore = r'''
(function(g) {
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64encode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
      out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
      out += i + 2 < bytes.length ? B64[c & 63] : '=';
    }
    return out;
  }
  function b64decode(text) {
    var clean = String(text).replace(/[^A-Za-z0-9+/]/g, '');
    var out = new Uint8Array(Math.floor(clean.length * 3 / 4));
    var o = 0;
    for (var i = 0; i < clean.length; i += 4) {
      var n = [0, 1, 2, 3].map(function(k) { return i + k < clean.length ? B64.indexOf(clean[i + k]) : -1; });
      out[o++] = (n[0] << 2) | (n[1] >> 4);
      if (n[2] >= 0) out[o++] = ((n[1] & 15) << 4) | (n[2] >> 2);
      if (n[3] >= 0) out[o++] = ((n[2] & 3) << 6) | n[3];
    }
    return out.subarray(0, o);
  }
  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Array.isArray(value)) return Uint8Array.from(value);
    throw new Error('需要二进制数据（ArrayBuffer/Uint8Array）');
  }
  function toArrayBuffer(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  function host(method, payload) {
    var raw = sendMessage('host', JSON.stringify({ m: method, p: payload === undefined ? {} : payload }));
    var res = JSON.parse(raw);
    if (!res.ok) throw res.e;
    return res.v;
  }
  var pending = {};
  var seq = 0;
  function hostAsync(method, payload) {
    return new Promise(function(resolve, reject) {
      var id = 'h' + (++seq);
      pending[id] = { resolve: resolve, reject: reject };
      var raw = sendMessage('host', JSON.stringify({ m: method, p: payload === undefined ? {} : payload, id: id }));
      var res = JSON.parse(raw);
      if (!res.ok) { delete pending[id]; reject(res.e); }
    });
  }
  g.__veneraSettle = function(id, raw) {
    var entry = pending[id];
    if (!entry) return;
    delete pending[id];
    var res = JSON.parse(raw);
    if (res.ok) entry.resolve(res.v); else entry.reject(res.e);
  };
  g.__veneraHost = host;
  g.__veneraHostAsync = hostAsync;
  g.__veneraB64 = { encode: b64encode, decode: b64decode, bytes: toBytes, buffer: toArrayBuffer };

  function define(proto, name, fn) {
    if (!proto[name]) Object.defineProperty(proto, name, { value: fn, writable: true, configurable: true });
  }
  function relIndex(length, index) {
    var n = Math.trunc(Number(index)) || 0;
    return n < 0 ? length + n : n;
  }
  define(Array.prototype, 'at', function(i) { var k = relIndex(this.length, i); return k < 0 || k >= this.length ? undefined : this[k]; });
  define(String.prototype, 'at', function(i) { var k = relIndex(this.length, i); return k < 0 || k >= this.length ? undefined : this[k]; });
  define(Array.prototype, 'findLast', function(fn, t) { for (var i = this.length - 1; i >= 0; i--) if (fn.call(t, this[i], i, this)) return this[i]; return undefined; });
  define(Array.prototype, 'findLastIndex', function(fn, t) { for (var i = this.length - 1; i >= 0; i--) if (fn.call(t, this[i], i, this)) return i; return -1; });
  define(Array.prototype, 'toReversed', function() { return this.slice().reverse(); });
  define(Array.prototype, 'toSorted', function(fn) { return this.slice().sort(fn); });
  if (!Object.hasOwn) Object.hasOwn = function(o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  if (typeof structuredClone === 'undefined') g.structuredClone = function(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
  if (typeof URLSearchParams === 'undefined') {
    g.URLSearchParams = function(init) {
      var self = this;
      this._p = [];
      if (typeof init === 'string') {
        init.replace(/^\?/, '').split('&').filter(Boolean).forEach(function(pair) {
          var i = pair.indexOf('=');
          var k = i < 0 ? pair : pair.slice(0, i), v = i < 0 ? '' : pair.slice(i + 1);
          self._p.push([decodeURIComponent(k.replace(/\+/g, ' ')), decodeURIComponent(v.replace(/\+/g, ' '))]);
        });
      } else if (init && typeof init === 'object') {
        Object.keys(init).forEach(function(k) { self._p.push([k, String(init[k])]); });
      }
    };
    g.URLSearchParams.prototype.get = function(k) { var e = this._p.find(function(p) { return p[0] === k; }); return e ? e[1] : null; };
    g.URLSearchParams.prototype.getAll = function(k) { return this._p.filter(function(p) { return p[0] === k; }).map(function(p) { return p[1]; }); };
    g.URLSearchParams.prototype.has = function(k) { return this._p.some(function(p) { return p[0] === k; }); };
    g.URLSearchParams.prototype.append = function(k, v) { this._p.push([k, String(v)]); };
    g.URLSearchParams.prototype.set = function(k, v) { this.delete(k); this._p.push([k, String(v)]); };
    g.URLSearchParams.prototype.delete = function(k) { this._p = this._p.filter(function(p) { return p[0] !== k; }); };
    g.URLSearchParams.prototype.toString = function() { return this._p.map(function(p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&'); };
  }
  if (typeof URL === 'undefined') {
    g.URL = function(url, base) {
      var text = String(url);
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
        if (!base) throw new TypeError('Invalid URL');
        var b = new g.URL(base);
        text = text.startsWith('//') ? b.protocol + text : text.startsWith('/') ? b.origin + text : b.origin + b.pathname.replace(/[^/]*$/, '') + text;
      }
      var m = text.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/);
      if (!m) throw new TypeError('Invalid URL');
      this.protocol = m[1].toLowerCase(); this.host = m[2].replace(/^[^@]*@/, ''); this.hostname = this.host.replace(/:\d+$/, '');
      this.port = (this.host.match(/:(\d+)$/) || [])[1] || ''; this.pathname = m[3] || '/'; this.search = m[4] && m[4] !== '?' ? m[4] : ''; this.hash = m[5] || '';
      this.origin = this.protocol + '//' + this.host; this.searchParams = new g.URLSearchParams(this.search);
      this.href = this.origin + this.pathname + this.search + this.hash;
    };
    g.URL.prototype.toString = function() { return this.href; };
  }
  g.setTimeout = function(callback, delay) {
    hostAsync('delay', { ms: delay || 0 }).then(callback);
  };
  g.atob = function(text) { return Array.prototype.map.call(b64decode(text), function(c) { return String.fromCharCode(c); }).join(''); };
  g.btoa = function(text) {
    return b64encode(Uint8Array.from(String(text).split('').map(function(c) { return c.charCodeAt(0) & 255; })));
  };
  function conv(type, isEncode, value, extra) {
    var payload = Object.assign({ type: type, isEncode: isEncode }, extra || {});
    if (value !== undefined) payload.value = typeof value === 'string' ? value : b64encode(toBytes(value));
    return host('convert', payload);
  }
  function bin(type, value, extra) {
    var out = conv(type, true, value, extra);
    return toArrayBuffer(b64decode(out));
  }
  g.Convert = {
    encodeUtf8: function(str) { return toArrayBuffer(b64decode(host('convert', { type: 'utf8', isEncode: true, value: String(str) }))); },
    decodeUtf8: function(value) { return host('convert', { type: 'utf8', isEncode: false, value: b64encode(toBytes(value)) }); },
    encodeBase64: function(value) { return b64encode(toBytes(value)); },
    decodeBase64: function(value) { return toArrayBuffer(b64decode(value)); },
    encodeGbk: function() { throw new Error('需要宿主能力：Convert.encodeGbk'); },
    decodeGbk: function() { throw new Error('需要宿主能力：Convert.decodeGbk'); },
    md5: function(v) { return bin('md5', v); },
    sha1: function(v) { return bin('sha1', v); },
    sha256: function(v) { return bin('sha256', v); },
    sha512: function(v) { return bin('sha512', v); },
    hmac: function(key, value, hash) { return bin('hmac', value, { key: b64encode(toBytes(key)), hash: hash }); },
    hmacString: function(key, value, hash) { return conv('hmac', true, value, { key: b64encode(toBytes(key)), hash: hash, isString: true }); },
    encryptAesEcb: function(v, key) { return bin('aes-ecb', v, { key: b64encode(toBytes(key)), isEncode: true }); },
    decryptAesEcb: function(v, key) { return toArrayBuffer(b64decode(conv('aes-ecb', false, v, { key: b64encode(toBytes(key)) }))); },
    encryptAesCbc: function(v, key, iv) { return bin('aes-cbc', v, { key: b64encode(toBytes(key)), iv: b64encode(toBytes(iv)) }); },
    decryptAesCbc: function(v, key, iv) { return toArrayBuffer(b64decode(conv('aes-cbc', false, v, { key: b64encode(toBytes(key)), iv: b64encode(toBytes(iv)) }))); },
    encryptAesCfb: function() { throw new Error('需要宿主能力：Convert.encryptAesCfb'); },
    decryptAesCfb: function() { throw new Error('需要宿主能力：Convert.decryptAesCfb'); },
    encryptAesOfb: function() { throw new Error('需要宿主能力：Convert.encryptAesOfb'); },
    decryptAesOfb: function() { throw new Error('需要宿主能力：Convert.decryptAesOfb'); },
    decryptRsa: function() { throw new Error('需要宿主能力：Convert.decryptRsa'); },
    hexEncode: function(bytes) {
      var view = toBytes(bytes), out = '';
      for (var i = 0; i < view.length; i++) out += (view[i] < 16 ? '0' : '') + view[i].toString(16);
      return out;
    }
  };
  g.createUuid = function() { return host('uuid'); };
  g.randomInt = function(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); };
  g.randomDouble = function(min, max) { return min + Math.random() * (max - min); };
  g.Cookie = function(init) { this.name = init.name; this.value = init.value; this.domain = init.domain; };
  function encodeBody(data) {
    if (data === undefined || data === null) return null;
    if (typeof data === 'string') return { kind: 'text', value: data };
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return { kind: 'bytes', value: b64encode(toBytes(data)) };
    return { kind: 'json', value: data };
  }
  async function request(method, url, headers, data, bytes) {
    var res = await hostAsync('http', { method: method, url: String(url), headers: headers || {}, body: encodeBody(data), bytes: bytes });
    return { status: res.status, headers: res.headers, body: bytes ? toArrayBuffer(b64decode(res.body)) : res.body };
  }
  g.Network = {
    fetchBytes: function(method, url, headers, data) { return request(method, url, headers, data, true); },
    sendRequest: function(method, url, headers, data) { return request(method, url, headers, data, false); },
    get: function(url, headers) { return request('GET', url, headers, null, false); },
    post: function(url, headers, data) { return request('POST', url, headers, data, false); },
    put: function(url, headers, data) { return request('PUT', url, headers, data, false); },
    patch: function(url, headers, data) { return request('PATCH', url, headers, data, false); },
    delete: function(url, headers) { return request('DELETE', url, headers, null, false); },
    setCookies: function(url, cookies) { host('cookie', { fn: 'set', url: url, cookies: cookies }); },
    getCookies: function(url) { return host('cookie', { fn: 'get', url: url }); },
    deleteCookies: function(url) { host('cookie', { fn: 'delete', url: url }); }
  };
  g.fetch = async function(url, options) {
    var o = options || {};
    var result = await request(o.method || 'GET', url, o.headers || {}, o.body || null, true);
    return {
      ok: result.status >= 200 && result.status < 300, status: result.status, statusText: '', headers: result.headers,
      arrayBuffer: async function() { return result.body; },
      text: async function() { return g.Convert.decodeUtf8(result.body); },
      json: async function() { return JSON.parse(g.Convert.decodeUtf8(result.body)); }
    };
  };
  function logger(level) {
    return function() {
      var text = Array.prototype.map.call(arguments, function(a) { return typeof a === 'string' ? a : JSON.stringify(a); }).join(' ');
      host('log', { level: level, text: text.slice(0, 500) });
    };
  }
  g.console = { log: logger('info'), info: logger('info'), warn: logger('warning'), error: logger('error'), debug: logger('info') };
  g.log = function(level, title, content) { host('log', { level: String(level), text: (title + ': ' + content).slice(0, 500) }); };
  g.APP = { version: '1.4.0', locale: 'zh_CN', platform: 'android' };
  g.UI = new Proxy({}, {
    get: function(_t, key) {
      if (key === 'showMessage') return function(message) { host('ui', { fn: 'message', text: String(message).slice(0, 300) }); };
      if (key === 'showLoading' || key === 'cancelLoading') return function() {};
      return function() { throw new Error('需要宿主能力：UI.' + String(key)); };
    }
  });
  g.compute = function() { throw new Error('需要宿主能力：compute'); };
  g.setClipboard = function() { throw new Error('需要宿主能力：setClipboard'); };
  g.getClipboard = function() { throw new Error('需要宿主能力：getClipboard'); };
  g.setInterval = function() { throw new Error('需要宿主能力：setInterval'); };
  g.Image = function() { throw new Error('需要宿主能力：Image'); };
  g.Image.empty = function() { throw new Error('需要宿主能力：Image.empty'); };
})(globalThis);
''';
