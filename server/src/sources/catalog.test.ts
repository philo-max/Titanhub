import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMarketCatalog, normalizeCatalog } from './catalog';
import fs from 'node:fs';
import { adaptKazumi } from '@titanhub/plugin-adapter';

afterEach(() => { vi.unstubAllGlobals(); });

describe('reference source catalogs', () => {
  it('matches all 17 bundled official rules to their catalog identifiers and versions', () => {
    const snapshot = require('./catalog-snapshot.json');
    const sources = normalizeCatalog('kazumi', snapshot.groups.find((group: { id: string }) => group.id === 'kazumi').items, 'anime');
    expect(sources).toHaveLength(17);
    for (const source of sources) {
      const name = new URL(source.downloadUrl).pathname.split('/').pop();
      const rule = JSON.parse(fs.readFileSync(new URL(`../plugins/rules/${name}`, import.meta.url), 'utf8'));
      expect(adaptKazumi(rule)).toMatchObject({ id: source.id, version: source.version });
    }
  });

  it('uses current root paths and the same Kazumi identifiers as the adapter', () => {
    expect(normalizeCatalog('kazumi', [{ name: '中文 Name', version: '2' }], 'anime')[0]).toMatchObject({
      id: 'kazumi-中文-name', version: '2', sourceType: 'kazumi', installable: true,
      downloadUrl: 'https://raw.githubusercontent.com/Predidit/KazumiRules/main/%E4%B8%AD%E6%96%87%20Name.json',
    });
  });

  it('supports actual Venera fileName and the documented filename or explicit URL fields', () => {
    expect(normalizeCatalog('venera', [{ name: 'A', fileName: 'a.js', key: 'a' }, { name: 'B', filename: 'b.js' }, { name: 'C', key: 'c', url: 'https://example.org/c.js' }], 'manga')
      .map(source => [source.id, source.compatibility])).toEqual([['venera-a', 'experimental'], ['venera-b', 'experimental'], ['venera-c', 'experimental']]);
  });

  it('distinguishes JavaScript and unsupported Dart sources with type-specific identities', () => {
    const entries = [
      { id: 1, name: 'JS', version: '0.2', sourceCodeLanguage: 1, sourceCodeUrl: 'https://example.org/a.js', baseUrl: 'https://example.org' },
      { id: 2, name: 'Dart', sourceCodeLanguage: 0, sourceCodeUrl: 'https://example.org/b.dart' },
    ];
    const manga = normalizeCatalog('mangayomi', entries, 'manga');
    expect(manga[0]).toMatchObject({ id: 'mangayomi-manga-1', installable: true, compatibility: 'experimental', metadata: entries[0] });
    expect(manga[1]).toMatchObject({ runtime: 'dart', installable: false, compatibility: 'unsupported' });
    expect(normalizeCatalog('mangayomi', entries, 'novel')[0].id).toBe('mangayomi-novel-1');
  });

  it('rejects malformed metadata and unsafe download URLs', () => {
    expect(() => normalizeCatalog('kazumi', {}, 'anime')).toThrow();
    expect(() => normalizeCatalog('venera', [{ name: 'X' }], 'manga')).toThrow();
    expect(() => normalizeCatalog('mangayomi', [{ id: 1, name: 'X', sourceCodeUrl: 'http://example.org/x.js' }], 'manga')).toThrow(/HTTPS/);
  });

  it('retains every audited reference entry when all remote indexes are unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })));
    const catalog = await loadMarketCatalog();
    expect(catalog.sources).toHaveLength(418);
    expect(catalog.sources.filter(source => source.runtime === 'dart')).toHaveLength(249);
    expect(catalog.providers.map(provider => [provider.id, provider.status, provider.count])).toEqual([
      ['kazumi', 'bundled', 17], ['venera', 'bundled', 33], ['mangayomi-manga', 'bundled', 363], ['mangayomi-novel', 'bundled', 5], ['lnreader', 'error', 0],
    ]);
    expect(catalog.providers[0].revision).toBe('0972545266e7ac7cc06e7e522892239824f7d713');
  });

  it('keeps live providers when another catalog fails or exceeds the size limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('KazumiRules')
      ? new Response(JSON.stringify([{ name: 'Live', version: '3' }]))
      : new Response('x'.repeat(2 * 1024 * 1024 + 1))));
    const catalog = await loadMarketCatalog();
    expect(catalog.providers[0]).toMatchObject({ status: 'live', count: 1 });
    expect(catalog.sources.some(source => source.id === 'kazumi-live')).toBe(true);
    expect(catalog.providers[1]).toMatchObject({ status: 'bundled', error: expect.stringContaining('大小限制') });
  });
});
