import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlugin } from '../db/db';
import { PluginManager } from './manager';
import { VENERA_SHIM } from '../../../packages/plugin-adapter/venera-runtime';

vi.mock('../db/db', () => ({ getPlugin: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

describe('installed source compatibility', () => {
  it('upgrades a saved legacy wrapper when opening its homepage without changing the stored plugin', async () => {
    const code = `// Wrapped Venera class source "Saved" by @titanhub/plugin-adapter\n${VENERA_SHIM}\n\nclass Saved extends ComicSource {explore=[{type:'multiPageComicList',load:async()=>({comics:[{id:'original-id',title:'Saved',cover:''}]})}]}\nconst __veneraInstance = new Saved();\nglobalThis.plugin={search:async()=>[]};`;
    const plugin = { id: 'venera-saved', name: 'Saved', version: '1', types: ['manga'] as 'manga'[], code, isActive: true };
    vi.mocked(getPlugin).mockResolvedValue(plugin);
    expect(await PluginManager.explore(plugin.id, 'manga')).toMatchObject({ success: true, data: [{ id: 'original-id' }] });
    expect(plugin.code).toBe(code);
    expect(plugin.isActive).toBe(true);
  });

  it('rejects direct requests to an unconfigured private service with an actionable reason', async () => {
    vi.stubEnv('ALIST_BASE_URL', '');
    vi.mocked(getPlugin).mockResolvedValue({ id: 'alist', name: 'Alist', version: '1', types: ['manga'], code: 'const url=globalThis.ALIST_BASE_URL;', isActive: true });
    expect(await PluginManager.explore('alist', 'manga')).toMatchObject({ success: false, error: expect.stringContaining('CONFIG_REQUIRED') });
  });
});
