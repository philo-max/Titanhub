import { describe, it, expect, vi } from 'vitest';
import * as cheerio from 'cheerio';
import { adaptKazumi, adaptVenera } from './index';

const kazumiRule = {
  name: '测试动漫源',
  version: '2.0.0',
  baseUrl: 'https://example.com',
  searchURL: 'https://example.com/search?q={keyword}',
  searchList: 'ul.results li',
  searchName: 'a.title',
  searchResult: 'a.title',
  chapterRoads: 'div.eps',
  chapterResult: 'a.ep',
};

describe('adaptKazumi', () => {
  it('generates a plugin with id, metadata and executable source', () => {
    const plugin = adaptKazumi(kazumiRule);
    expect(plugin.id).toMatch(/^kazumi-/);
    expect(plugin.name).toBe('测试动漫源');
    expect(plugin.version).toBe('2.0.0');
    expect(plugin.types).toEqual(['anime']);
    expect(plugin.code).toContain('globalThis.plugin = plugin');
    expect(plugin.code).toContain('https://example.com/search?q={keyword}');
    expect(plugin.code).toContain('@keyword|\\{keyword\\}');
    expect(() => new Function(plugin.code.replace('await fetch', 'fetch'))).not.toThrow();
  });

  it('maps movie type rules to the movie media type', () => {
    const plugin = adaptKazumi({ ...kazumiRule, type: 'movie' });
    expect(plugin.types).toEqual(['movie']);
  });

  it('rejects rules missing required fields', () => {
    const incomplete = { ...kazumiRule };
    delete (incomplete as any).searchURL;
    expect(() => adaptKazumi(incomplete as any)).toThrow(/searchURL/);
  });

  it('accepts native Kazumi rules using the baseURL field casing', () => {
    const rest = { ...kazumiRule };
    delete (rest as any).baseUrl;
    const plugin = adaptKazumi({ ...rest, baseURL: 'https://native.example.com/' });
    expect(plugin.code).toContain('https://native.example.com/');
  });

  it('rejects rules missing both baseUrl and baseURL', () => {
    const incomplete = { ...kazumiRule };
    delete (incomplete as any).baseUrl;
    expect(() => adaptKazumi(incomplete as any)).toThrow(/baseUrl/);
  });
});

type SelectFn = (html: string, selector: string) => string;

function loadChapters(rule: Record<string, unknown>, html: string, select: SelectFn) {
  const fetch = vi.fn(async () => ({ text: async () => html }));
  const context: Record<string, any> = {};
  const htmlParser = { select, selectText: () => '' };
  new Function('fetch', 'globalThis', 'htmlParser', adaptKazumi(rule as any).code)(fetch, context, htmlParser);
  return context.plugin;
}

const cssSelect: SelectFn = (html, selector) => {
  const $ = cheerio.load(html);
  return JSON.stringify($(selector).toArray().map(el => ({ text: $(el).text().trim(), html: $(el).html() || '', attrs: (el as any).attribs || {} })));
};

const roadsHtml = '<div class="eps"><a class="ep" href="/p/1-1">第1集</a><a class="ep" href="/p/1-2">第2集</a></div>'
  + '<div class="eps"><a class="ep" href="/p/2-1">第1集</a></div>';

describe('Kazumi chapter lines', () => {
  it('keeps XPath road boundaries with per-line numbering and unchanged ids and titles', async () => {
    const roads = [{ html: 'road-a' }, { html: 'road-b' }];
    const items: Record<string, unknown[]> = {
      'road-a': [{ text: '第1集', attrs: { href: '/p/1-1' } }, { text: '第2集', attrs: { href: '/p/1-2' } }],
      'road-b': [{ text: '第1集', attrs: { href: '/p/2-1' } }],
    };
    const plugin = loadChapters({ ...kazumiRule, chapterRoads: '//div[@class="eps"]', chapterResult: '//a' }, 'page',
      (html, selector) => JSON.stringify(selector === '//div[@class="eps"]' ? roads : items[html] || []));
    expect(await plugin.getChapters(encodeURIComponent('/detail/1'))).toEqual([
      { id: encodeURIComponent('/p/1-1'), title: '线路1·第1集', chapterNo: 1, lineId: 'line-1', lineName: '线路1' },
      { id: encodeURIComponent('/p/1-2'), title: '线路1·第2集', chapterNo: 2, lineId: 'line-1', lineName: '线路1' },
      { id: encodeURIComponent('/p/2-1'), title: '线路2·第1集', chapterNo: 1, lineId: 'line-2', lineName: '线路2' },
    ]);
  });

  it('keeps a single XPath road free of line metadata', async () => {
    const plugin = loadChapters({ ...kazumiRule, chapterRoads: '//div', chapterResult: '//a' }, 'page',
      (html, selector) => JSON.stringify(selector === '//div' ? [{ html: 'only' }] : [{ text: ' 第1集\n  sss ', attrs: { href: '/p/1' } }]));
    expect(await plugin.getChapters('x')).toEqual([{ id: encodeURIComponent('/p/1'), title: '第1集 sss', chapterNo: 1 }]);
  });

  it('collapses whitespace in titles without touching the letter s', async () => {
    expect(adaptKazumi(kazumiRule).code).toContain('.replace(/\\s+/g, \' \')');
    const html = '<div class="eps"><a class="ep" href="/p/s1">  Season\ts  1\n\n sss </a></div>'
      + '<div class="eps"><a class="ep" href="/p/s2">s\r\n第 2 集 Specials</a></div>';
    const plugin = loadChapters(kazumiRule, html, cssSelect);
    expect((await plugin.getChapters('x')).map((chapter: any) => [chapter.title, chapter.lineId])).toEqual([
      ['Season s 1 sss', 'line-1'], ['s 第 2 集 Specials', 'line-2'],
    ]);
  });

  it('keeps CSS road boundaries without changing the flat order, ids or titles', async () => {
    const plugin = loadChapters(kazumiRule, roadsHtml, cssSelect);
    const chapters = await plugin.getChapters('x');
    expect(chapters.map((chapter: any) => decodeURIComponent(chapter.id))).toEqual(['/p/1-1', '/p/1-2', '/p/2-1']);
    expect(chapters.map((chapter: any) => chapter.title)).toEqual(['第1集', '第2集', '第1集']);
    expect(chapters.map((chapter: any) => [chapter.lineId, chapter.lineName, chapter.chapterNo])).toEqual([
      ['line-1', '线路1', 1], ['line-1', '线路1', 2], ['line-2', '线路2', 1],
    ]);
  });

  it('falls back to the combined CSS selection when per-road selection loses episodes', async () => {
    const combined = loadChapters({ ...kazumiRule, chapterRoads: 'div.eps', chapterResult: 'a.ep' }, roadsHtml, (html, selector) => {
      if (html !== roadsHtml) return '[]';
      return cssSelect(html, selector);
    });
    expect((await combined.getChapters('x')).map((chapter: any) => [chapter.title, chapter.chapterNo, chapter.lineId])).toEqual([
      ['第1集', 1, undefined], ['第2集', 2, undefined], ['第1集', 3, undefined],
    ]);
  });
});

describe('adaptVenera', () => {
  it('wraps an object-style source with method mapping', () => {
    const source =
      'globalThis.source = { async searchComics(q) { return [{ comicId: "1", name: q }]; } };';
    const plugin = adaptVenera(source, { id: 'venera-test', name: 'Venera 测试源' });
    expect(plugin.id).toBe('venera-test');
    expect(plugin.types).toEqual(['manga']);
    expect(plugin.code).toContain(source.trim());
    expect(plugin.code).toContain('globalThis.plugin = {');
  });

  it('wraps a class-based source with the runtime shim and instance bridge', () => {
    const source =
      'class MySource extends ComicSource { search = { load: async () => ({ comics: [] }) } }';
    const plugin = adaptVenera(source, { id: 'venera-class', name: 'Class 源' });
    expect(plugin.code).toContain('new MySource()');
    expect(plugin.code).toContain('globalThis.plugin = {');
  });
});
