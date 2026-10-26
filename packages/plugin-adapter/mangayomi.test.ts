import { readFileSync } from 'node:fs';
import { createCipheriv } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as cheerio from 'cheerio';
import { adaptMangayomi } from './mangayomi';

const metadata = { id: 'mangayomi-teamx', name: 'TeamX', type: 'manga' as const, baseUrl: 'https://olympustaff.com', lang: 'ar' };
const teamx = readFileSync(new URL('./mangayomi-teamx.fixture.txt', import.meta.url), 'utf8');
const novel = readFileSync(new URL('./mangayomi-webnoveltranslations.fixture.txt', import.meta.url), 'utf8');
const mangadex = readFileSync(new URL('./mangayomi-mangadex.fixture.txt', import.meta.url), 'utf8');

function load(source: string, responses: string[], meta = metadata) {
  const fetch = vi.fn(async () => ({ status: 200, headers: {}, text: async () => responses.shift() ?? '' }));
  const htmlParser = {
    select(html: string, selector: string) {
      const $ = cheerio.load(html);
      return JSON.stringify($(selector).toArray().map(element => ({ text: $(element).text().trim(), html: $(element).html() ?? '', attrs: $(element).attr() ?? {} })));
    },
  };
  const context: Record<string, any> = {};
  new Function('fetch', 'htmlParser', 'globalThis', adaptMangayomi(source, meta).code)(fetch, htmlParser, context);
  return { plugin: context.plugin, fetch };
}

describe('Mangayomi JavaScript adapter', () => {
  it('executes upstream TeamX search, details, chapters and image parsing', async () => {
    const detail = '<div class="author-info-title"><h1>Title</h1></div><img class="shadow-sm" src="/cover.jpg"><div class="review-content"><p>Summary</p></div><div class="eplister"><ul><a href="/chapter/1"><div class="epl-num">1</div><div class="epl-title">First</div><div class="epl-date">2025-01-01</div></a></ul></div>';
    const { plugin, fetch } = load(teamx, [
      '<li class="list-group-item"><a><img src="/cover.jpg"></a><div class="ms-2"><a href="/series/1">Title</a></div></li>',
      detail, detail, '<div class="image_list"><img src="//cdn.example/1.jpg"><img src="/2.jpg"></div>',
    ]);
    const results = await plugin.search('hero', 'manga');
    expect(results).toEqual([{ id: '/series/1', title: 'Title', cover: 'https://olympustaff.com/cover.jpg', description: '' }]);
    expect(fetch.mock.calls[0][0]).toBe('https://olympustaff.com/ajax/search?keyword=hero');
    expect(await plugin.getDetail(results[0].id)).toMatchObject({ id: '/series/1', title: 'Title', description: 'Summary' });
    const chapters = await plugin.getChapters(results[0].id);
    expect(chapters[0]).toMatchObject({ title: '1 - First' });
    expect(await plugin.getImages(chapters[0].id)).toEqual(['https://cdn.example/1.jpg', 'https://olympustaff.com/2.jpg']);
  });

  it('executes upstream novel HTML parsing and chapter POST requests', async () => {
    const { plugin, fetch } = load(novel, [
      '<div class="row c-tabs-item__content"><h3>Novel</h3><img src="/cover.jpg"><div class="tab-thumb c-image-hover"><a href="/novel/one/"></a></div></div>',
      '<div class="post-title"><h1>Novel</h1></div><div class="summary__content"><p>Summary</p></div><div class="author-content"><a>Author</a></div>',
      '<li class="wp-manga-chapter"><a href="/chapter/one">Chapter One</a></li>',
      '<h1 id="chapter-heading">Chapter One</h1><div id="novel-chapter-container" class="text-left"><p>Actual text</p></div>',
    ], { ...metadata, type: 'novel' as any, baseUrl: 'https://webnoveltranslations.com' });
    expect((await plugin.search('hero', 'novel'))[0].title).toBe('Novel');
    const chapters = await plugin.getChapters('/novel/one/');
    expect(fetch.mock.calls[2]).toEqual(['https://webnoveltranslations.com/novel/one/ajax/chapters/?t=1', { method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest' } }]);
    expect(await plugin.getContent(chapters[0].id)).toContain('<p>Actual text</p>');
    expect(fetch.mock.calls[3][0]).toBe('https://webnoveltranslations.com/chapter/one');
  });

  it('preserves source metadata, default preferences and form/JSON requests', async () => {
    const source = `class DefaultExtension extends MProvider {
      getSourcePreferences() { return [{key:'domain', editTextPreference:{value:'default'}}]; }
      async search() {
        const client = new Client();
        await client.post(this.source.apiUrl, {'content-type':'application/json',cookie:'session=test'}, {language:this.source.lang});
        await client.post(this.source.baseUrl, {}, {q:'a & b'});
        return {list:[{name:new SharedPreferences().get('domain'),link:'/one'}]};
      }
    }`;
    const { plugin, fetch } = load(source, ['', ''], { ...metadata, apiUrl: 'https://api.example/search' } as any);
    expect((await plugin.search('x'))[0].title).toBe('default');
    expect(fetch.mock.calls[0]).toEqual(['https://api.example/search', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'session=test' }, body: '{"language":"ar"}' }]);
    expect(fetch.mock.calls[1][1]).toMatchObject({ body: 'q=a%20%26%20b', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  });

  it('fails explicitly on unsupported APIs, missing preferences and malformed responses', async () => {
    const unsupported = load('class DefaultExtension extends MProvider { async search() { return evaluateJavascriptViaWebview("https://example.com"); } }', []);
    await expect(unsupported.plugin.search('x')).rejects.toThrow('unsupported');
    const preferences = load('class DefaultExtension extends MProvider { async search() { return new SharedPreferences().get("account"); } }', []);
    await expect(preferences.plugin.search('x')).rejects.toThrow('account');
    const malformed = load('class DefaultExtension extends MProvider { async search() { return {}; } }', []);
    await expect(malformed.plugin.search('x')).rejects.toThrow('list');
  });

  it('rejects Dart, unsupported media and absent metadata without executing source', () => {
    expect(() => adaptMangayomi('class DefaultExtension extends MProvider {}', { ...metadata, sourceCodeLanguage: 0 })).toThrow('Dart');
    expect(() => adaptMangayomi('import "package:html/parser.dart";', metadata)).toThrow('Dart');
    expect(() => adaptMangayomi(teamx, { ...metadata, type: 'anime' as any })).toThrow('type');
    expect(() => adaptMangayomi(teamx, { ...metadata, baseUrl: '' })).toThrow('baseUrl');
  });

  it('propagates HTTP errors and does not claim missing host headers exist', async () => {
    const source = 'class DefaultExtension extends MProvider { async search() { const response = await new Client().get(this.source.baseUrl); return {list: [{name:response.headers["x-title"],link:"/one"}]}; } }';
    const context: Record<string, any> = {};
    new Function('fetch', 'globalThis', adaptMangayomi(source, metadata).code)(async () => ({ status: 403, text: async () => 'Forbidden' }), context);
    await expect(context.plugin.search('x')).rejects.toThrow('HTTP 403');
    new Function('fetch', 'globalThis', adaptMangayomi(source, metadata).code)(async () => ({ status: 200, text: async () => '' }), context);
    await expect(context.plugin.search('x')).rejects.toThrow('response headers');
  });

  it('preserves upstream MangaDex API paths and opaque chapter IDs', async () => {
    const manga = { id: 'book-id', attributes: { title: { en: 'API title' }, description: { en: 'Summary' }, tags: [], status: 'ongoing' }, relationships: [] };
    const { plugin, fetch } = load(mangadex, [
      JSON.stringify({ data: [manga] }),
      JSON.stringify({ data: manga }),
      JSON.stringify({ data: [{ id: 'chapter-id', attributes: { chapter: '1', title: 'First', publishAt: '2025-01-01' }, relationships: [] }], limit: 500, total: 1 }),
      JSON.stringify({ baseUrl: 'https://uploads.example', chapter: { hash: 'hash', data: ['one.jpg'] } }),
    ], { ...metadata, apiUrl: 'https://api.mangadex.org', baseUrl: 'https://mangadex.org', lang: 'en' } as any);
    const result = await plugin.search('hero');
    expect(result[0]).toMatchObject({ id: '/manga/book-id', title: 'API title' });
    const chapters = await plugin.getChapters(result[0].id);
    expect(fetch.mock.calls[1][0]).toBe('https://api.mangadex.org/manga/book-id?includes[]=cover_art&includes[]=author&includes[]=artist');
    expect(await plugin.getImages(chapters[0].id)).toEqual(['https://uploads.example/data/hash/one.jpg']);
    expect(fetch.mock.calls[3][0]).toBe('https://api.mangadex.org/at-home/server/chapter-id');
  });

  it('runs actual upstream JavaScript inside the production QuickJS sandbox', async () => {
    const { PluginSandbox } = await import('../../server/src/plugins/sandbox');
    const html = '<li class="list-group-item"><a><img src="/cover.jpg"></a><div class="ms-2"><a href="/series/1">Sandbox title</a></div></li>';
    const code = adaptMangayomi(teamx, metadata).code;
    const sandbox = new PluginSandbox('mangayomi-fixture', code + '\nglobalThis.plugin.search = async function(query, type) { fetch = async function() { return {status:200,text:async function(){return ' + JSON.stringify(html) + ';}}; }; return __list("search", [query, 1, []]); };');
    const result = await sandbox.runMethod<any[]>('search', ['hero', 'manga']);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.data?.[0]).toMatchObject({ id: '/series/1', title: 'Sandbox title' });
  });

  it('bridges Mangayomi AES-CBC transport decryption through sandbox Convert', async () => {
    const { PluginSandbox } = await import('../../server/src/plugins/sandbox');
    const key = '0123456789abcdef';
    const iv = 'abcdef0123456789';
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update('Public API payload'), cipher.final()]).toString('base64');
    const source = `class DefaultExtension extends MProvider { async search() { return {list:[{name:cryptoHandler('${encrypted}','${iv}','${key}',false),link:String(this.source.id)}]}; } }`;
    const sandbox = new PluginSandbox('mangayomi-crypto-fixture', adaptMangayomi(source, { ...metadata, sourceId: 123 }).code);
    const result = await sandbox.runMethod<any[]>('search', ['x']);
    expect(result.error).toBeUndefined();
    expect(result.data?.[0]).toMatchObject({ title: 'Public API payload', id: '123' });
  });

  it('preserves percent escapes in upstream media and chapter identities', async () => {
    const source = `class DefaultExtension extends MProvider {
      async getDetail(id) { return {name:id,chapters:[{name:'One',url:'opaque%2Fchapter'}]}; }
      async getPageList(id) { if (id !== 'opaque%2Fchapter') throw new Error('corrupt chapter ID'); return ['https://cdn.example/one.jpg']; }
    }`;
    const { plugin } = load(source, []);
    expect((await plugin.getDetail('/book/a%2Fb')).title).toBe('/book/a%2Fb');
    const chapters = await plugin.getChapters('/book/a%2Fb');
    expect(await plugin.getImages(chapters[0].id)).toEqual(['https://cdn.example/one.jpg']);
  });
});
