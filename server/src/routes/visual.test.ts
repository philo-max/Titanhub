import { describe, it, expect } from 'vitest';
import visual from './visual';

// Helper to create a minimal Hono app with the visual route mounted
import { Hono } from 'hono';
import { signUserToken } from '../auth/jwt';

const app = new Hono();
app.route('/api/visual', visual);

// Sign a valid token for authenticated requests
let validToken: string;

// Helper to sign token before each test
async function ensureToken() {
  if (!validToken) {
    validToken = await signUserToken('test-user');
  }
}

describe('Visual route (POST /api/visual/search)', () => {
  it('returns 401 without authentication', async () => {
    const res = await app.request('/api/visual/search', {
      method: 'POST',
      body: new FormData(),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when no image is provided', async () => {
    await ensureToken();
    const formData = new FormData();
    const res = await app.request('/api/visual/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: formData,
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('image');
  });

  it('returns 413 when image exceeds size limit', async () => {
    await ensureToken();
    // Create a fake file larger than 10MB
    const largeBuffer = new Uint8Array(11 * 1024 * 1024);
    const largeFile = new File([largeBuffer], 'huge.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('image', largeFile);

    const res = await app.request('/api/visual/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
      body: formData,
    });
    expect(res.status).toBe(413);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain('too large');
  });
});
