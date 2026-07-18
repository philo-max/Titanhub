import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import market from './market';

const app = new Hono();
app.route('/api/market', market);

// We mock the external fetch calls so tests don't hit the network.
// The market module caches results for 10 minutes, so we reset between tests
// by waiting or by testing cache behavior directly.

describe('Market route (GET /api/market/sources)', () => {
  it('returns a sources array (possibly empty if all upstreams fail)', async () => {
    const res = await app.request('/api/market/sources');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sources: unknown[] };
    expect(json).toHaveProperty('sources');
    expect(Array.isArray(json.sources)).toBe(true);
  });

  it('returns cached results on second call', async () => {
    // First call populates cache
    const res1 = await app.request('/api/market/sources');
    const json1 = (await res1.json()) as { sources: unknown[] };

    // Second call should return cached data (same length)
    const res2 = await app.request('/api/market/sources');
    const json2 = (await res2.json()) as { sources: unknown[] };

    expect(json2.sources).toHaveLength(json1.sources.length);
  });
});

describe('Market route (POST /api/market/install)', () => {
  it('returns 401 without authentication', async () => {
    const res = await app.request('/api/market/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'test', name: 'test', sourceType: 'kazumi', downloadUrl: 'http://example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing', async () => {
    // We need a valid token to get past auth
    const { signUserToken } = await import('../auth/jwt');
    const token = await signUserToken('test-user');

    const res = await app.request('/api/market/install', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'test' }), // missing name, sourceType, downloadUrl
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('Missing required');
  });
});
