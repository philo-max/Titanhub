import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPluginMutation } from './plugin-request';
import { useLocalSessionStore } from '@/stores/localSessionStore';
import { useAuthStore } from '@/stores/authStore';

const session = { apiBase: 'http://127.0.0.1:3217', token: 'L'.repeat(43) };

describe('plugin management credentials', () => {
  const fetchMock = vi.fn(async () => new Response('{}'));
  beforeEach(() => {
    useLocalSessionStore.setState({ status: 'idle', session: null, error: null });
    useAuthStore.setState({ token: 'cloud-token', user: { id: 'cloud', username: 'cloud' } });
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits for preload and sends every protected operation only to its trusted local address', async () => {
    const getLocalSession = vi.fn(async () => session);
    vi.stubGlobal('window', { location: new URL('http://untrusted.example/?apiBase=http://attacker.example'), titanhubDesktop: { isDesktop: true, apiBase: session.apiBase, getLocalSession } });
    for (const [path, method] of [
      ['/api/plugins/source', 'PATCH'], ['/api/plugins/source', 'DELETE'],
      ['/api/plugins', 'POST'], ['/api/market/install', 'POST'],
    ]) {
      await fetchPluginMutation(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' } });
      const [url, init] = fetchMock.mock.calls.at(-1)! as unknown as [string, RequestInit];
      expect(url).toBe(`${session.apiBase}${path}`);
      expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${session.token}`);
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    }
    expect(getLocalSession).toHaveBeenCalledTimes(1);
  });

  it('never falls back to a cloud token or untrusted address when desktop initialization fails', async () => {
    vi.stubGlobal('window', { titanhubDesktop: { isDesktop: true, getLocalSession: async () => { throw new Error('unavailable'); } } });
    await expect(fetchPluginMutation('/api/plugins/source', { method: 'DELETE' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves browser cloud authentication and refuses logged-out mutations', async () => {
    vi.stubGlobal('window', { location: new URL('http://127.0.0.1:3000/') });
    await fetchPluginMutation('/api/plugins', { method: 'POST' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3001/api/plugins');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer cloud-token');
    useAuthStore.setState({ token: null, user: null });
    await expect(fetchPluginMutation('/api/plugins', { method: 'POST' })).rejects.toThrow(/登录/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
