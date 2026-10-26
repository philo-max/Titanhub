import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

describe('Healthcheck API', () => {
  it('returns ok status and current timestamp', async () => {
    const app = new Hono();
    app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; timestamp: number };
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('number');
    expect(body.timestamp).toBeGreaterThan(0);
  });
});
