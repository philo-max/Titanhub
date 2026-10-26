import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWebDavConfig, syncWebDavSettings } from './webdav-settings';
import { useSyncStore } from '@/stores/syncStore';
import { flushProgress } from './progress-flush';

vi.mock('./progress-flush', () => ({ flushProgress: vi.fn() }));

const config = { url: 'https://dav.example/files/', username: 'reader', allowInsecureHttp: false };

afterEach(() => { vi.restoreAllMocks(); });

describe('WebDAV settings', () => {
  it('omits an empty password to preserve the saved credential', () => {
    expect(buildWebDavConfig(config, '')).toEqual(config);
    expect(buildWebDavConfig(config, ' new password ')).toEqual({ ...config, password: ' new password ' });
  });

  it('requires explicit opt-in for HTTP and rejects credentials in the server URL', () => {
    expect(() => buildWebDavConfig({ ...config, url: 'http://dav.example/files/' }, '')).toThrow('HTTP');
    expect(buildWebDavConfig({ ...config, url: 'http://dav.example/files/', allowInsecureHttp: true }, '')).toMatchObject({ allowInsecureHttp: true });
    expect(() => buildWebDavConfig({ ...config, url: 'https://name:secret@dav.example/' }, '')).toThrow();
    expect(() => buildWebDavConfig({ ...config, url: 'file:///data' }, '')).toThrow();
  });

  it('waits for confirmed local writes and refreshes both lists after synchronization', async () => {
    const order: string[] = [];
    vi.mocked(flushProgress).mockImplementationOnce(() => { order.push('progress'); });
    vi.spyOn(useSyncStore.getState(), 'flushLocalWrites').mockImplementation(async () => { order.push('flush'); return true; });
    vi.spyOn(useSyncStore.getState(), 'pullTracking').mockImplementation(async () => { order.push('tracking'); });
    vi.spyOn(useSyncStore.getState(), 'pullFavorites').mockImplementation(async () => { order.push('favorites'); });
    const bridge = { syncWebDav: async () => { order.push('sync'); return { uploaded: 1 }; } };
    expect(await syncWebDavSettings(bridge)).toEqual({ uploaded: 1 });
    expect(flushProgress).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['progress', 'flush', 'sync', 'tracking', 'favorites']);
  });

  it('blocks remote synchronization when local writes have not been confirmed', async () => {
    vi.spyOn(useSyncStore.getState(), 'flushLocalWrites').mockResolvedValue(false);
    const syncWebDav = vi.fn();
    await expect(syncWebDavSettings({ syncWebDav })).rejects.toThrow('本地');
    expect(syncWebDav).not.toHaveBeenCalled();
  });

  it('surfaces synchronization and refresh failures', async () => {
    vi.spyOn(useSyncStore.getState(), 'flushLocalWrites').mockResolvedValue(true);
    const pullTracking = vi.spyOn(useSyncStore.getState(), 'pullTracking').mockResolvedValue();
    vi.spyOn(useSyncStore.getState(), 'pullFavorites').mockResolvedValue();
    await expect(syncWebDavSettings({ syncWebDav: async () => { throw new Error('remote unavailable'); } })).rejects.toThrow('remote unavailable');
    expect(pullTracking).not.toHaveBeenCalled();
    pullTracking.mockRejectedValue(new Error('refresh failed'));
    await expect(syncWebDavSettings({ syncWebDav: async () => ({}) })).rejects.toThrow('refresh failed');
  });
});
