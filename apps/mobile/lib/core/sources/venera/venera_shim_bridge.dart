const String veneraShimBridge = r'''
(function(g) {
  var UNSUPPORTED = '需要宿主能力：';
  function src() {
    var s = g.__veneraInstance;
    if (!s) throw new Error('来源尚未加载');
    return s;
  }
  function entriesOf(value) {
    if (!value) return [];
    if (typeof value.entries === 'function' && !Array.isArray(value)) return Array.from(value.entries());
    return Object.keys(value).map(function(k) { return [k, value[k]]; });
  }
  function text(value) { return value === undefined || value === null ? '' : String(value); }
  function media(c) {
    return {
      id: text(c.id), title: c.title || '未命名', cover: c.cover || '',
      description: c.description || c.subTitle || c.subtitle || ''
    };
  }
  function comics(list) {
    if (!Array.isArray(list)) throw new Error('来源返回的漫画列表格式无效');
    return list.filter(function(c) { return c && c.id !== undefined && c.id !== null && c.id !== ''; }).map(media);
  }
  function defaultOptions(s) {
    var list = (s.search && s.search.optionList) || [];
    return list.map(function(option) {
      if (option.default !== undefined && option.default !== null) return option.default;
      var first = (option.options || [])[0];
      return typeof first === 'string' ? first.split('-')[0] : '';
    });
  }
  function defaultCategoryOptions(s) {
    var list = (s.categoryComics && s.categoryComics.optionList) || [];
    return list.map(function(option) {
      if (option.default !== undefined && option.default !== null) return option.default;
      var first = (option.options || [])[0];
      return typeof first === 'string' ? first.split('-')[0] : '';
    });
  }
  async function searchPage(keyword, page) {
    var s = src();
    var kw = String(keyword || '').trim();
    if (kw.indexOf('tag:') === 0) {
      var rawTag = kw.slice(4).trim();
      var param = null;
      var category = rawTag;
      var colonIdx = rawTag.indexOf(':');
      if (colonIdx > 0 && colonIdx < rawTag.length - 1) {
        param = rawTag.slice(0, colonIdx).trim();
        category = rawTag.slice(colonIdx + 1).trim();
      }
      if (s.categoryComics && typeof s.categoryComics.load === 'function' && category) {
        try {
          var catRes = await s.categoryComics.load(category, param, defaultCategoryOptions(s), page);
          if (catRes && Array.isArray(catRes.comics) && catRes.comics.length > 0) {
            return { comics: comics(catRes.comics), maxPage: catRes.maxPage || null };
          }
        } catch (_) {}
      }
      kw = rawTag;
    }
    if (!s.search) return { comics: [], maxPage: 1 };
    var res = typeof s.search.load === 'function'
      ? await s.search.load(kw, defaultOptions(s), page)
      : typeof s.search.loadNext === 'function'
        ? await s.search.loadNext(kw, defaultOptions(s), page > 1 ? String(page) : null)
        : null;
    if (!res) throw new Error('来源没有提供搜索');
    return { comics: comics(res.comics), maxPage: res.maxPage || null };
  }
  async function exploreFirst(targetTitle) {
    var s = src();
    var pages = Array.isArray(s.explore) ? s.explore : [];
    if (pages.length === 0) throw new Error('HOME_UNSUPPORTED: 该来源没有首页');
    var candidates = targetTitle
      ? pages.filter(function(p) { return text(p.title) === String(targetTitle); })
      : pages;
    if (candidates.length === 0) candidates = pages;
    var failures = [];
    for (var i = 0; i < candidates.length; i++) {
      var page = candidates[i];
      try {
        var result;
        var type = page.type;
        if (type === 'singlePageWithMultiPart') {
          var map = await page.load();
          result = entriesOf(map).flatMap(function(e) { return Array.isArray(e[1]) ? e[1] : []; });
        } else if (type === 'multiPartPage') {
          var parts = await page.load();
          if (!Array.isArray(parts)) throw new Error('首页分区格式无效');
          result = parts.flatMap(function(p) { return p && Array.isArray(p.comics) ? p.comics : []; });
        } else if (type === 'multiPageComicList') {
          var r = typeof page.load === 'function' ? await page.load(1) : await page.loadNext(null);
          result = r && r.comics;
        } else if (type === 'mixed') {
          var m = await page.load(0);
          result = ((m && m.data) || []).flatMap(function(p) { return Array.isArray(p) ? p : p && Array.isArray(p.comics) ? p.comics : []; });
        } else {
          throw new Error(UNSUPPORTED + '首页类型 ' + type);
        }
        return { title: page.title || '', comics: comics(result) };
      } catch (e) {
        failures.push(String((e && e.message) || e));
      }
    }
    throw new Error(failures.join('；'));
  }
  async function loadInfo(id) {
    var s = src();
    var d = await s.comic.loadInfo(id);
    if (!d || typeof d !== 'object') throw new Error('来源返回的详情格式无效');
    return d;
  }
  function tagsToGenres(tags) {
    var genres = [];
    if (Array.isArray(tags)) tags.forEach(function(t) { genres.push(String(t)); });
    else entriesOf(tags).forEach(function(e) { if (Array.isArray(e[1])) e[1].forEach(function(t) { genres.push(String(t)); }); });
    return genres;
  }
  function mapDetail(id, d) {
    return {
      id: id, title: d.title || id, cover: d.cover || '', description: d.description || '',
      genres: tagsToGenres(d.tags), status: d.updateTime || undefined,
      author: typeof d.uploader === 'string' ? d.uploader : undefined
    };
  }
  function mapChapters(id, d) {
    var ch = d.chapters;
    var entries = entriesOf(ch);
    if (!ch) return [{ id: id + '::', title: '全一话', chapterNo: 1 }];
    var out = [];
    entries.forEach(function(e) {
      var value = e[1];
      if (value && typeof value === 'object') {
        entriesOf(value).forEach(function(inner) {
          out.push({ id: id + '::' + inner[0], title: text(inner[1]) || ('第 ' + (out.length + 1) + ' 话'), chapterNo: out.length + 1, groupId: text(e[0]), groupName: text(e[0]) });
        });
      } else {
        out.push({ id: id + '::' + e[0], title: typeof value === 'string' ? value : ('第 ' + (out.length + 1) + ' 话'), chapterNo: out.length + 1 });
      }
    });
    return out;
  }
  async function detail(id) { return mapDetail(id, await loadInfo(id)); }
  async function chapters(id) { return mapChapters(id, await loadInfo(id)); }
  async function info(id) {
    var d = await loadInfo(id);
    return { detail: mapDetail(id, d), chapters: mapChapters(id, d) };
  }
  async function images(comicId, epId) {
    var s = src();
    var res = await s.comic.loadEp(comicId, epId === '' || epId === undefined ? null : epId);
    var list = res && res.images;
    if (!Array.isArray(list)) throw new Error('来源返回的图片列表格式无效');
    var hook = typeof s.comic.onImageLoad === 'function' ? s.comic.onImageLoad.bind(s.comic) : null;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var url = typeof item === 'string' ? item : item && item.url;
      var headers = Object.assign({}, typeof item === 'object' && item ? item.headers : {});
      var modifyImage = null;
      if (hook) {
        var config = (await hook(url, comicId, epId === '' ? null : epId)) || {};
        if (config.onResponse) throw new Error(UNSUPPORTED + '图片响应处理（onResponse）');
        if (config.data !== undefined && config.data !== null) throw new Error(UNSUPPORTED + '带请求体的图片请求');
        if (config.method && String(config.method).toUpperCase() !== 'GET') throw new Error(UNSUPPORTED + '非 GET 图片请求');
        if (config.modifyImage) {
          modifyImage = typeof config.modifyImage === 'function'
            ? config.modifyImage.toString()
            : String(config.modifyImage);
        }
        Object.assign(headers, config.headers || {});
        url = config.url || url;
      }
      if (typeof url !== 'string' || !url) throw new Error('图片地址无效');
      out.push({ url: url, headers: headers, modifyImage: modifyImage });
    }
    return out;
  }
  function describeSettings(s) {
    return entriesOf(s.settings).map(function(e) {
      var def = e[1];
      if (!def || typeof def !== 'object') def = (s.__settingDefs && s.__settingDefs[e[0]]) || {};
      return {
        key: e[0], title: text(def.title), type: text(def.type), default: def.default === undefined ? null : def.default,
        options: Array.isArray(def.options) ? def.options.map(function(o) { return { value: text(o.value), text: text(o.text || o.value) }; }) : null
      };
    });
  }
  function describe() {
    var s = src();
    var account = s.account || null;
    return {
      name: text(s.name), key: text(s.key), version: text(s.version), url: text(s.url),
      hasSearch: !!(s.search && (s.search.load || s.search.loadNext)),
      explore: (Array.isArray(s.explore) ? s.explore : []).map(function(p) { return { title: text(p.title), type: text(p.type) }; }),
      settings: describeSettings(s),
      account: account ? {
        login: typeof account.login === 'function', webLogin: !!account.loginWithWebview,
        cookieLogin: !!account.loginWithCookies, registerWebsite: text(account.registerWebsite)
      } : null,
      isLogged: !!s.isLogged
    };
  }
  async function login(user, password) {
    var s = src();
    if (!s.account || typeof s.account.login !== 'function') throw new Error(UNSUPPORTED + '账号密码登录');
    await s.account.login(user, password);
    return true;
  }
  async function logout() {
    var s = src();
    if (s.account && typeof s.account.logout === 'function') await s.account.logout();
    return true;
  }
  g.__titan = {
    describe: describe, searchPage: searchPage, explore: exploreFirst, detail: detail, info: info,
    chapters: chapters, images: images, login: login, logout: logout,
    init: async function() { var s = src(); if (typeof s.init === 'function') await s.init(); return true; }
  };
})(globalThis);
''';
