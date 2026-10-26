import { describe, it, expect, vi } from 'vitest';
import { load } from 'cheerio';
import fixture from './venera-official.fixture.json';
import { VENERA_SHIM } from './venera-runtime';
import { PluginSandbox } from '../../server/src/plugins/sandbox';
import { adaptVenera } from './index';

const htmlParser = {
  select(html: string, selector: string) {
    const $ = load(html);
    return JSON.stringify($(selector).toArray().map((el) => ({
      text: $(el).text().trim(), html: $(el).html() || '',
      attrs: 'attribs' in el ? el.attribs : {},
    })));
  },
  selectText(html: string, selector: string) {
    const $ = load(html);
    return $(selector).text().trim();
  },
};

function evaluate(code: string, fetcher: unknown = vi.fn(), convert: unknown = {}) {
  return new Function('htmlParser', 'fetch', 'Convert', `${VENERA_SHIM}\n${code}`)(htmlParser, fetcher, convert);
}

describe('Venera host runtime', () => {
  it('preserves the sandbox crypto API and supplies defaults and in-memory state', () => {
    const convert = { encodeUtf8: vi.fn(), md5: vi.fn() };
    const result = evaluate(`
      class Source extends ComicSource {
        settings = { language: { default: 'cn' }, flags: { default: [1] } };
      }
      const source = new Source();
      source.saveData('token', 'abc');
      const value = source.loadData('token');
      source.deleteData('token');
      return { convert: Convert, value, deleted: source.loadData('token'),
        language: source.loadSetting('language'), locale: APP.locale,
        random: randomInt(2, 2), other: new Source().loadData('token') };
    `, undefined, convert);
    expect(result).toMatchObject({ convert, value: 'abc', deleted: null, language: 'cn', locale: 'zh_CN', random: 2, other: null });
  });

  it('supports nested DOM, attributes, siblings and removal with consistent parent text', () => {
    const result = evaluate(`
      const doc = new HtmlDocument('<section id="s"><a href="/a"><b>A</b><i>ad</i></a><a>B</a></section>');
      const section = doc.getElementById('s');
      const first = section.querySelector('a');
      first.querySelector('i').remove();
      return { text: section.text, href: first.attributes.href, inner: first.innerHtml,
        count: section.children.length, sibling: first.nextSibling.text, parent: first.parent.id };
    `);
    expect(result).toEqual({ text: 'AB', href: '/a', inner: '<b>A</b>', count: 2, sibling: 'B', parent: 's' });
  });

  it('preserves HTTP headers and JSON request bodies without swallowing errors', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('body', { status: 201, headers: { 'x-token': 'ok' } }));
    const result = await evaluate(`return Network.post('https://example.com', { 'content-type': 'application/json' }, { a: 1 });`, fetcher);
    expect(result).toMatchObject({ status: 201, body: 'body', headers: { 'x-token': 'ok' } });
    expect(fetcher.mock.calls[0][1].body).toBe('{"a":1}');
    await expect(evaluate(`return Network.get('https://example.com');`, vi.fn().mockRejectedValue(new Error('blocked')))).rejects.toThrow('blocked');
    expect(() => evaluate(`return Network.setCookies('https://example.com', []);`)).toThrow(/Cookie/);
  });

  it('initializes each source once and retains initialization failures', async () => {
    expect(await evaluate(`
      const source = new ComicSource(); let calls = 0;
      source.init = async () => { calls++; };
      return Promise.all([__veneraInitialize(source), __veneraInitialize(source)]).then(() => calls);
    `)).toBe(1);
    await expect(evaluate(`
      const source = new ComicSource(); source.init = async () => { throw new Error('init failed'); };
      return __veneraInitialize(source);
    `)).rejects.toThrow('init failed');
  });

  it('normalizes fragments and decodes attributes without corrupting entities', () => {
    const result = evaluate(`
      const doc = new HtmlDocument('<a href="/search?q=one&amp;page=2">A &amp; B</a>');
      return { body: doc.body.text, href: doc.body.querySelector('a').attributes.href };
    `);
    expect(result).toEqual({ body: 'A & B', href: '/search?q=one&page=2' });
  });

  it('executes the frozen official YKMH search, detail, chapters and images parser', async () => {
    const search = '<li class="list-comic" data-key="1"><a class="image-link" href="/manhua/a/" title="测试"><img src="/cover.jpg"></a><p><a href="/manhua/a/">测试</a></p><p class="auth"><a href="/author/">作者</a></p><p class="newPage">第1话</p></li>';
    const detail = '<div class="BarTit" id="comicName">测试</div><div class="pic" id="Cover"><mip-img src="https://img.example/cover.jpg"></mip-img></div><li><a href="/chapter/1"><span>第一话</span></a></li>';
    const fetcher = vi.fn(async (url: string) => new Response(
      url.includes('/search/') ? search : url.includes('/chapter/')
        ? '<script>var chapterImages = ["https://img.example/1.jpg"];</script>' : detail,
    ));
    const result = await evaluate(`${fixture.source}\n
      const source = new YKMHSource();
      return (async () => {
        await __veneraInitialize(source);
        const found = await source.search.load('测试', [], 1);
        const info = await source.comic.loadInfo(found.comics[0].id);
        const chapters = Array.from(info.chapters.entries());
        const pages = await source.comic.loadEp(found.comics[0].id, chapters[0][0]);
        return { title: found.comics[0].title, detail: info.title, chapters, images: pages.images };
      })();
    `, fetcher);
    expect(result).toEqual({
      title: '测试', detail: '测试',
      chapters: [['https://m.ykmh.net/chapter/1', '第一话']],
      images: ['https://img.example/1.jpg'],
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fixture.commit).toBe('a04e05591f7832f7166d6660546613c114d6738a');
  });

  it('runs nested DOM and preserves native Convert inside the real QuickJS sandbox', async () => {
    const code = `${VENERA_SHIM}\n
      globalThis.plugin = { async search() {
        const doc = new HtmlDocument('<main><a href="/a">A<b>ad</b></a></main>');
        doc.querySelector('a').querySelector('b').remove();
        const bytes = Convert.encodeUtf8(doc.querySelector('main').text);
        return [{ id: Convert.decodeUtf8(bytes), title: Convert.encodeBase64(bytes) }];
      } };
    `;
    const result = await new PluginSandbox(code).runMethod('search', []);
    expect(result).toMatchObject({ success: true, data: [{ id: 'A', title: 'QQ==' }] });
  });

  it('executes the official parser with isolated transport in the real QuickJS sandbox', async () => {
    const code = `${VENERA_SHIM}\n${fixture.source}\n
      globalThis.plugin = { async search() {
        fetch = async (url) => ({ status: 200, headers: { 'content-type': 'text/html' }, text: () =>
          url.includes('/search/')
            ? '<li class="list-comic" data-key="1"><a class="image-link" href="/manhua/a/" title="测试"><img src="/cover.jpg"></a><p><a href="/manhua/a/">测试</a></p><p class="auth"><a href="/author/">作者</a></p><p class="newPage">第一话</p></li>'
            : url.includes('/chapter/') ? '<script>var chapterImages = ["https://img.example/1.jpg"];</script>'
            : '<div class="BarTit" id="comicName">测试</div><li><a href="/chapter/1"><span>第一话</span></a></li>'
        });
        const source = new YKMHSource();
        await __veneraInitialize(source);
        const found = await source.search.load('测试', [], 1);
        const info = await source.comic.loadInfo(found.comics[0].id);
        const chapters = Array.from(info.chapters.entries());
        const pages = await source.comic.loadEp(found.comics[0].id, chapters[0][0]);
        return { title: found.comics[0].title, detail: info.title, chapters, images: pages.images };
      } };
    `;
    const result = await new PluginSandbox(code).runMethod('search', []);
    expect(result).toMatchObject({ success: true, data: {
      title: '测试', detail: '测试', chapters: [['https://m.ykmh.net/chapter/1', '第一话']],
      images: ['https://img.example/1.jpg'],
    } });
  });

  it('reports unsupported capabilities and disposed documents instead of succeeding silently', async () => {
    expect(() => evaluate(`Network.fetchBytes('GET', 'https://example.com');`)).toThrow(/binary HTTP/);
    expect(() => evaluate(`UI.showDialog('Login', 'required');`)).toThrow(/interactive UI/);
    expect(() => evaluate(`const doc = new HtmlDocument('<p>A</p>'); doc.dispose(); return doc.querySelector('p');`)).toThrow(/disposed/);
    expect(() => evaluate(`randomInt(3, 1);`)).toThrow(/bounds/);
    const result = await evaluate(`return Network.get('https://example.com');`, async () => ({
      status: 403, headers: { 'Retry-After': '5' }, text: () => 'verification required',
    }));
    expect(result).toEqual({ status: 403, headers: { 'retry-after': '5' }, body: 'verification required' });
  });

  it.skipIf(process.env.TITANHUB_LIVE_SOURCES !== '1')('checks a public official source against the current site', async () => {
    const result = await evaluate(`${fixture.source}\n
      const source = new YKMHSource();
      return (async () => {
        await __veneraInitialize(source);
        const found = await source.search.load('海贼王', [], 1);
        if (!found.comics.length) throw new Error('Live search returned no comics');
        const info = await source.comic.loadInfo(found.comics[0].id);
        const chapters = Array.from(info.chapters.entries());
        if (!chapters.length) throw new Error('Live detail returned no chapters');
        const pages = await source.comic.loadEp(found.comics[0].id, chapters[0][0]);
        return { title: info.title, chapters: chapters.length, images: pages.images.length };
      })();
    `, (url: string, options: RequestInit) => fetch(url, { ...options, signal: AbortSignal.timeout(12000) }));
    expect(result.chapters).toBeGreaterThan(0);
    expect(result.images).toBeGreaterThan(0);
    console.log('Live official source:', result);
  }, 45000);

  it.skipIf(process.env.TITANHUB_LIVE_SOURCES !== '1')('checks the integrated adapter through the guarded sandbox against the current site', async () => {
    const adapted = adaptVenera(fixture.source, { id: 'venera-live-ykmh', name: '优酷漫画' });
    const sandbox = new PluginSandbox(adapted.id, adapted.code);
    const search = await sandbox.runMethod<Array<{ id: string }>>('search', ['海贼王']);
    expect(search.success, search.error).toBe(true);
    expect(search.data?.length).toBeGreaterThan(0);
    const id = search.data![0].id;
    const detail = await sandbox.runMethod<{ title: string }>('getDetail', [id]);
    expect(detail.success, detail.error).toBe(true);
    expect(detail.data?.title).toBeTruthy();
    const chapters = await sandbox.runMethod<Array<{ id: string }>>('getChapters', [id]);
    expect(chapters.success, chapters.error).toBe(true);
    expect(chapters.data?.length).toBeGreaterThan(0);
    const images = await sandbox.runMethod<string[]>('getImages', [chapters.data![0].id]);
    expect(images.success, images.error).toBe(true);
    expect(images.data?.length).toBeGreaterThan(0);
  }, 45000);
});
