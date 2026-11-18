import { describe, expect, it } from 'vitest';
import { sourceIdentity, sourceConfigurationMessage, withSourceMetadata } from './identity';

const plugin = (id: string, code = '') => ({ id, name: 'MangaDex', code });

describe('source identity and configuration prerequisites', () => {
  it('distinguishes old installed language implementations and builtin sources without renaming IDs', () => {
    expect(sourceIdentity(plugin('mangayomi-manga-593575397'))).toMatchObject({ sourceInfo: { ecosystem: 'mangayomi', lang: 'zh' } });
    expect(sourceIdentity(plugin('venera-manga_dex'))).toMatchObject({ sourceInfo: { ecosystem: 'venera' } });
    expect(sourceIdentity({ ...plugin('mangadex'), isBuiltin: true }).displayName).toContain('内置');
    expect(sourceIdentity(plugin('user-source')).sourceInfo.ecosystem).toBe('custom');
    expect(sourceIdentity(plugin('manual-source', '// Wrapped Venera class source "Manual" by @titanhub/plugin-adapter\nclass Manual {}')).sourceInfo.ecosystem).toBe('venera');
  });

  it('persists only source metadata in existing code storage, with no database migration', () => {
    const original = 'globalThis.plugin = {search: async()=>[]};';
    const code = withSourceMetadata(original, { ecosystem: 'mangayomi', lang: 'fr', compatibility: 'experimental' });
    expect(sourceIdentity(plugin('new-remote-source', code))).toMatchObject({ sourceInfo: { ecosystem: 'mangayomi', lang: 'fr', compatibility: 'experimental' } });
    expect(withSourceMetadata(code, { ecosystem: 'venera' }).match(/__titanhubSourceMetadata/g)).toHaveLength(1);
    expect(code).not.toContain('password');
  });

  it('skips an unconfigured Alist rather than contacting localhost, without changing activation', () => {
    const source = { ...plugin('alist', 'const url=globalThis.ALIST_BASE_URL;'), isActive: true };
    expect(sourceConfigurationMessage(source, {})).toContain('配置');
    expect(sourceConfigurationMessage(source, { ALIST_BASE_URL: 'https://private.example' })).toBeUndefined();
    expect(source.isActive).toBe(true);
    expect(sourceConfigurationMessage(plugin('alist', "const url='https://configured.example'"), {})).toBeUndefined();
  });

  it('does not silently use private-server demonstration endpoints', () => {
    expect(sourceConfigurationMessage(plugin('venera-komga', "settings={server:{default:'https://demo.komga.org'}}"), {})).toContain('设置');
    expect(sourceConfigurationMessage(plugin('venera-komga', "settings={server:{default:'https://my-server.example'}}"), {})).toBeUndefined();
  });
});
