import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseLocalSession } from '@/lib/local-session';
import { useLocalSessionStore, resolveCredentials } from './localSessionStore';
import { useAuthStore } from './authStore';

const TOKEN = 'A'.repeat(43);
const SESSION = { apiBase: 'http://127.0.0.1:3101', token: TOKEN };

function installWindow(bridge?: Record<string, unknown>) {
  (globalThis as any).window = {
    location: new URL('http://127.0.0.1:3000/'),
    titanhubDesktop: bridge,
  };
}

describe('desktop local session store', () => {
  beforeEach(() => {
    useLocalSessionStore.setState({ status: 'idle', session: null, error: null });
    useAuthStore.setState({ token: null, user: null });
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('validates the session shape handed over by preload', () => {
    expect(parseLocalSession(SESSION)).toEqual(SESSION);
    expect(parseLocalSession({ ...SESSION, token: 'short' })).toBeNull();
    expect(parseLocalSession({ ...SESSION, apiBase: 'http://evil.example:3101' })).toBeNull();
    expect(parseLocalSession({ ...SESSION, apiBase: 'http://127.0.0.1:3101/path?x=1' })).toBeNull();
    expect(parseLocalSession(null)).toBeNull();
  });

  it('initialises from the preload bridge and keeps the token only in memory', async () => {
    const getLocalSession = vi.fn(async () => SESSION);
    installWindow({ isDesktop: true, apiBase: SESSION.apiBase, getLocalSession });
    expect(await useLocalSessionStore.getState().initialize()).toBe(true);
    expect(useLocalSessionStore.getState()).toMatchObject({ status: 'ready', session: SESSION, error: null });
    expect(getLocalSession).toHaveBeenCalledTimes(1);
    expect((useLocalSessionStore as any).persist).toBeUndefined();
    expect(JSON.stringify(useAuthStore.getState())).not.toContain(TOKEN);
  });

  it('reports failures and recovers on retry', async () => {
    const getLocalSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('Local session request rejected.'))
      .mockResolvedValueOnce(SESSION);
    installWindow({ isDesktop: true, getLocalSession });
    expect(await useLocalSessionStore.getState().initialize()).toBe(false);
    expect(useLocalSessionStore.getState().status).toBe('error');
    expect(useLocalSessionStore.getState().error).toBeTruthy();

    expect(await useLocalSessionStore.getState().initialize()).toBe(true);
    expect(useLocalSessionStore.getState().status).toBe('ready');
  });

  it('rejects malformed sessions instead of treating them as ready', async () => {
    installWindow({ isDesktop: true, getLocalSession: async () => ({ apiBase: 'http://127.0.0.1:1', token: '' }) });
    expect(await useLocalSessionStore.getState().initialize()).toBe(false);
    expect(useLocalSessionStore.getState().status).toBe('error');
  });

  it('rejects a valid session addressed to a different backend than preload', async () => {
    installWindow({ isDesktop: true, apiBase: 'http://127.0.0.1:9999', getLocalSession: async () => SESSION });
    expect(await useLocalSessionStore.getState().initialize()).toBe(false);
    expect(resolveCredentials()).toBeNull();
  });

  it('shares an in-flight initialization request', async () => {
    const getLocalSession = vi.fn(async () => SESSION);
    installWindow({ isDesktop: true, getLocalSession });
    expect(await Promise.all([useLocalSessionStore.getState().initialize(), useLocalSessionStore.getState().initialize()])).toEqual([true, true]);
    expect(getLocalSession).toHaveBeenCalledTimes(1);
  });

  it('resolves desktop credentials from the local session and never from a cloud token', async () => {
    useAuthStore.setState({ token: 'cloud.jwt.token', user: { id: 'u', username: 'n' } });
    installWindow({ isDesktop: true, getLocalSession: async () => SESSION });
    expect(resolveCredentials()).toBeNull();
    await useLocalSessionStore.getState().initialize();
    expect(resolveCredentials()).toEqual({ apiBase: SESSION.apiBase, token: TOKEN, mode: 'local' });
    expect(useAuthStore.getState().token).toBe('cloud.jwt.token');
  });

  it('keeps the browser account flow unchanged outside the desktop shell', async () => {
    installWindow(undefined);
    expect(await useLocalSessionStore.getState().initialize()).toBe(false);
    expect(useLocalSessionStore.getState().status).toBe('idle');
    expect(resolveCredentials()).toBeNull();
    useAuthStore.setState({ token: 'cloud.jwt.token', user: { id: 'u', username: 'n' } });
    expect(resolveCredentials()).toEqual({ apiBase: 'http://127.0.0.1:3001', token: 'cloud.jwt.token', mode: 'cloud' });
  });
});
