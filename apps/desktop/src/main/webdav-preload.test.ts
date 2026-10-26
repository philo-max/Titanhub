import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ bridge: null as Record<string, any> | null, invoke: vi.fn() }));
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (_name: string, bridge: Record<string, unknown>) => { state.bridge = bridge; } },
  ipcRenderer: { on: vi.fn(), send: vi.fn(), invoke: state.invoke },
}));

describe('WebDAV preload surface', () => {
  beforeEach(() => { vi.resetModules(); state.invoke.mockClear(); });

  it('exposes four fixed operations and forwards no renderer credentials to test or sync', async () => {
    await import('../preload/index');
    const bridge = state.bridge!;
    bridge.getWebDavConfig();
    const input = { url: 'https://dav.example/', username: 'reader', password: 'new-password', allowInsecureHttp: false };
    bridge.saveWebDavConfig(input);
    bridge.testWebDav({ password: 'injected' });
    bridge.syncWebDav({ password: 'injected' });
    expect(state.invoke.mock.calls).toEqual([
      ['webdav:config:get'], ['webdav:config:save', input], ['webdav:test'], ['webdav:sync'],
    ]);
    expect(bridge).not.toHaveProperty('invoke');
    expect(bridge).not.toHaveProperty('send');
    expect(bridge).not.toHaveProperty('ipcRenderer');
  });
});
