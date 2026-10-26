import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getApiBase, API_BASE } from './config';

describe('Runtime API_BASE dynamic resolution', () => {
  let mockWindow: any;
  let mockSessionStorage: Record<string, string>;

  beforeEach(() => {
    mockSessionStorage = {};
    mockWindow = {
      location: new URL('http://127.0.0.1:3000/'),
      sessionStorage: {
        getItem: (k: string) => mockSessionStorage[k] || null,
        setItem: (k: string, v: string) => { mockSessionStorage[k] = v; },
        clear: () => { mockSessionStorage = {}; },
      },
    };
    (globalThis as any).window = mockWindow;
    (globalThis as any).sessionStorage = mockWindow.sessionStorage;
  });

  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).sessionStorage;
  });

  it('prefers window.titanhubDesktop.apiBase when available (Electron preload)', () => {
    mockWindow.titanhubDesktop = {
      apiBase: 'http://127.0.0.1:3999',
    };
    expect(getApiBase()).toBe('http://127.0.0.1:3999');
    expect(String(API_BASE)).toBe('http://127.0.0.1:3999');
    expect(`${API_BASE}/api/plugins`).toBe('http://127.0.0.1:3999/api/plugins');
  });

  it('reads apiBase from URL query parameters and caches in sessionStorage', () => {
    mockWindow.location = new URL('http://127.0.0.1:3000/?apiBase=http%3A%2F%2F127.0.0.1%3A3005');
    expect(getApiBase()).toBe('http://127.0.0.1:3005');
    expect(mockWindow.sessionStorage.getItem('titanhub_api_base')).toBe('http://127.0.0.1:3005');
  });

  it('falls back to default 127.0.0.1:3001 if no desktop bridge or query param', () => {
    mockWindow.location = new URL('http://127.0.0.1:3000/');
    expect(getApiBase()).toBe('http://127.0.0.1:3001');
  });

  it('never returns a Promise even if desktop object has async methods', () => {
    mockWindow.titanhubDesktop = {
      apiBase: '', // Empty
      getApiBase: () => Promise.resolve('http://127.0.0.1:3999'),
    };
    mockWindow.location = new URL('http://127.0.0.1:3000/?apiBase=http%3A%2F%2F127.0.0.1%3A3008');
    const result = getApiBase();
    expect(typeof result).toBe('string');
    expect(result).toBe('http://127.0.0.1:3008');
    expect(result).not.toBeInstanceOf(Promise);
  });
});
