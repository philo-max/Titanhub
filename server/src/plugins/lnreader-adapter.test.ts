import { describe, it, expect } from 'vitest';
import { adaptLNReader } from '@titanhub/plugin-adapter';
import { PluginSandbox } from './sandbox';

const commonJsSource = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var cheerio_1 = require("cheerio");
var dayjs_1 = __importDefault(require("dayjs"));
var novelStatus_1 = require("@libs/novelStatus");
var filterInputs_1 = require("@libs/filterInputs");
var defaultCover_1 = require("@libs/defaultCover");
function __importDefault(mod) { return mod && mod.__esModule ? mod : { default: mod }; }

class TestPlugin {
  constructor() {
    this.id = 'test';
    this.name = 'Test';
    this.site = 'https://novels.example';
    this.filters = {
      sort: { type: filterInputs_1.FilterTypes.Picker, value: 'popular', options: [] },
    };
  }
  async popularNovels(page, options) {
    return [{ name: 'Popular ' + page + ' ' + options.filters.sort.value, path: '/n/popular' }];
  }
  async searchNovels(term) {
    const url = new URL('/search?q=' + encodeURIComponent(term), this.site);
    const params = new URLSearchParams({ q: term });
    return [{ name: term + '|' + url.pathname + '|' + params.toString(), path: '/n/1', cover: '/c.jpg' }];
  }
  async parseNovel(novelPath) {
    const $ = (0, cheerio_1.load)('<div class="info"><h1>Title</h1><span class="a">Author</span></div>');
    return {
      path: novelPath,
      name: $('h1').text(),
      author: $('.a').text(),
      cover: defaultCover_1.defaultCover,
      status: novelStatus_1.NovelStatus.Ongoing,
      genres: 'Action, Fantasy',
      summary: (0, dayjs_1.default)('2024-03-05T00:00:00Z').toISOString(),
      chapters: [
        { name: 'Chapter 1', path: '/n/1/1', chapterNumber: 1 },
        { name: 'Chapter 2', path: '/n/1/2', chapterNumber: 2 },
      ],
    };
  }
  async parseChapter(chapterPath) {
    const $ = (0, cheerio_1.load)('<article><p>Hello</p><p>World</p></article>');
    return $('article').html() + chapterPath;
  }
}
exports.default = new TestPlugin();
`;

describe('LNReader CommonJS source running inside the real sandbox', () => {
  const plugin = adaptLNReader(commonJsSource, { id: 'lnreader-test', name: 'Test' });
  const sandbox = () => new PluginSandbox(plugin.id, plugin.code);

  it('explores with default filter values', async () => {
    const result = await sandbox().runMethod<{ id: string; title: string }[]>('explore', ['novel']);
    expect(result.success).toBe(true);
    expect(result.data?.[0]).toMatchObject({ id: '/n/popular', title: 'Popular 1 popular' });
  });

  it('searches using URL and URLSearchParams polyfills', async () => {
    const result = await sandbox().runMethod<{ id: string; title: string; cover: string }[]>('search', ['dragon']);
    expect(result.success).toBe(true);
    expect(result.data?.[0]).toMatchObject({
      id: '/n/1',
      title: 'dragon|/search|q=dragon',
      cover: 'https://novels.example/c.jpg',
    });
  });

  it('parses detail and chapters through real cheerio and dayjs', async () => {
    const detail = await sandbox().runMethod<Record<string, unknown>>('getDetail', ['/n/1']);
    expect(detail.success).toBe(true);
    expect(detail.data).toMatchObject({ title: 'Title', author: 'Author', status: 'Ongoing', description: '2024-03-05T00:00:00.000Z' });
    expect(detail.data?.genres).toEqual(['Action', 'Fantasy']);

    const chapters = await sandbox().runMethod<{ id: string; title: string; chapterNo: number }[]>('getChapters', ['/n/1']);
    expect(chapters.data).toEqual([
      { id: '/n/1/1', title: 'Chapter 1', chapterNo: 1 },
      { id: '/n/1/2', title: 'Chapter 2', chapterNo: 2 },
    ]);
  });

  it('returns chapter HTML', async () => {
    const result = await sandbox().runMethod<string>('getContent', ['/n/1/1']);
    expect(result.success).toBe(true);
    expect(result.data).toBe('<p>Hello</p><p>World</p>/n/1/1');
  });
});

describe('legacy LNReader plugin upgrade', () => {
  it('re-adapts code stored by the old shim and leaves current code alone', async () => {
    const { upgradeLegacyLNReaderCode } = await import('@titanhub/plugin-adapter');
    const meta = { id: 'lnreader-legacy', name: 'Legacy', version: '1.0.0' };
    const legacy = `// Wrapped LNReader source "Legacy" by @titanhub/plugin-adapter\n// ---- LNReader runtime shim (Titanhub) ----\nOLD\n// ---- end LNReader shim ----\n\n${commonJsSource}\n\n// ── LNReader -> Titanhub plugin bridge ──\nOLD BRIDGE`;
    const upgraded = upgradeLegacyLNReaderCode(legacy, meta);
    expect(upgraded).toContain('__lnrLibs');
    expect(upgradeLegacyLNReaderCode(upgraded as string, meta)).toBeNull();
    const result = await new PluginSandbox(meta.id, upgraded as string).runMethod<string>('getContent', ['/n/1/1']);
    expect(result.data).toBe('<p>Hello</p><p>World</p>/n/1/1');
  });
});
