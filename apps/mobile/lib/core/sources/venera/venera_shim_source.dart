const String veneraShimSource = r'''
(function(g) {
  var host = g.__veneraHost;
  function html(fn, data) { return host('html', Object.assign({ fn: fn }, data)); }
  var docSeq = 0;
  class HtmlDocument {
    constructor(source) {
      this.key = docSeq++;
      html('parse', { key: this.key, data: String(source) });
    }
    querySelector(query) {
      var k = html('querySelector', { key: this.key, query: query });
      return k == null ? null : new HtmlElement(k, this.key);
    }
    querySelectorAll(query) {
      var self = this;
      return html('querySelectorAll', { key: this.key, query: query }).map(function(k) { return new HtmlElement(k, self.key); });
    }
    dispose() { html('dispose', { key: this.key }); }
    getElementById(id) {
      var k = html('getElementById', { key: this.key, id: id });
      return k == null ? null : new HtmlElement(k, this.key);
    }
  }
  class HtmlElement {
    constructor(k, doc) { this.key = k; this.doc = doc; }
    _q(fn, extra) { return html(fn, Object.assign({ key: this.key, doc: this.doc }, extra)); }
    _el(k) { return k == null ? null : new HtmlElement(k, this.doc); }
    get text() { return this._q('getText'); }
    get attributes() { return this._q('getAttributes'); }
    querySelector(query) { return this._el(this._q('dom_querySelector', { query: query })); }
    querySelectorAll(query) { var self = this; return this._q('dom_querySelectorAll', { query: query }).map(function(k) { return self._el(k); }); }
    get children() { var self = this; return this._q('getChildren').map(function(k) { return self._el(k); }); }
    get nodes() { var self = this; return this._q('getNodes').map(function(k) { return new HtmlNode(k, self.doc); }); }
    get innerHTML() { return this._q('getInnerHTML'); }
    get parent() { return this._el(this._q('getParent')); }
    get classNames() { return this._q('getClassNames'); }
    get id() { return this._q('getId'); }
    get localName() { return this._q('getLocalName'); }
    get previousElementSibling() { return this._el(this._q('getPreviousSibling')); }
    get nextElementSibling() { return this._el(this._q('getNextSibling')); }
  }
  class HtmlNode {
    constructor(k, doc) { this.key = k; this.doc = doc; }
    get text() { return html('node_text', { key: this.key, doc: this.doc }); }
    get type() { return html('node_type', { key: this.key, doc: this.doc }); }
    toElement() {
      var k = html('node_to_element', { key: this.key, doc: this.doc });
      return k == null ? null : new HtmlElement(k, this.doc);
    }
  }
  g.HtmlDocument = HtmlDocument;
  g.HtmlElement = HtmlElement;
  g.HtmlNode = HtmlNode;
  function assign(target, source) { Object.keys(source || {}).forEach(function(k) { target[k] = source[k]; }); }
  g.Comic = function(init) { assign(this, init); };
  g.ComicDetails = function(init) { assign(this, init); if (this.subtitle === undefined) this.subtitle = this.subTitle; };
  g.Comment = function(init) { assign(this, init); };
  g.ImageLoadingConfig = function(init) { assign(this, init); };
  class ComicSource {
    constructor() { this.name = ''; this.key = ''; this.version = ''; this.minAppVersion = ''; this.url = ''; this.translation = {}; }
    loadData(dataKey) { var v = host('load_data', { key: dataKey }); return v === null ? undefined : v; }
    saveData(dataKey, data) { return host('save_data', { key: dataKey, data: data === undefined ? null : data }); }
    deleteData(dataKey) { return host('delete_data', { key: dataKey }); }
    loadSetting(key) {
      var stored = host('load_setting', { key: key });
      if (stored.has) return stored.value;
      var cur = this.settings ? this.settings[key] : undefined;
      if (cur !== undefined && cur !== null && typeof cur !== 'object' && typeof cur !== 'function') return cur;
      var snap = this.__settingDefaults;
      if (snap && Object.prototype.hasOwnProperty.call(snap, key)) return snap[key];
      if (cur && typeof cur === 'object' && 'default' in cur) return cur.default;
      throw 'Setting not found: ' + key;
    }
    get isLogged() { return host('isLogged'); }
    translate(key) { var t = this.translation && this.translation[g.APP.locale]; return (t && t[key]) || key; }
    init() {}
  }
  ComicSource.sources = {};
  g.ComicSource = ComicSource;
  g.__veneraSnapshotSettings = function(inst) {
    var defaults = {}, defs = {};
    try {
      var s = inst && inst.settings;
      if (s && typeof s === 'object') {
        Object.keys(s).forEach(function(k) {
          var d = s[k];
          if (!d || typeof d !== 'object') return;
          defs[k] = Object.assign({}, d);
          if (d.default === undefined) return;
          try { defaults[k] = JSON.parse(JSON.stringify(d.default)); } catch (e) { defaults[k] = d.default; }
        });
      }
    } catch (e) {}
    Object.defineProperty(inst, '__settingDefaults', { value: defaults, enumerable: false });
    Object.defineProperty(inst, '__settingDefs', { value: defs, enumerable: false });
  };
})(globalThis);
''';
