import { describe, it, expect } from 'vitest';
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
    const { searchURL, ...incomplete } = kazumiRule;
    expect(() => adaptKazumi(incomplete as any)).toThrow(/searchURL/);
  });

  it('accepts native Kazumi rules using the baseURL field casing', () => {
    const { baseUrl, ...rest } = kazumiRule;
    const plugin = adaptKazumi({ ...rest, baseURL: 'https://native.example.com/' });
    expect(plugin.code).toContain('https://native.example.com/');
  });

  it('rejects rules missing both baseUrl and baseURL', () => {
    const { baseUrl, ...incomplete } = kazumiRule;
    expect(() => adaptKazumi(incomplete as any)).toThrow(/baseUrl/);
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
    expect(plugin.code).toContain('Venera runtime shim');
    expect(plugin.code).toContain('new MySource()');
    expect(plugin.code).toContain('globalThis.plugin = {');
  });
});
