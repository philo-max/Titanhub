import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import {
  initLocalSession,
  resetLocalSession,
  setLocalSessionAddress,
  verifyLocalToken,
  createLocalChallengeResponse,
  computeLocalChallengeProof,
  buildExternalProcessEnv,
  LOCAL_USER_ID,
} from './local-session';
import { requireAuth, signUserToken } from './jwt';

const TOKEN = crypto.randomBytes(32).toString('base64url');

function buildApp() {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.get('/private', requireAuth, (c) => c.json({ userId: c.get('userId') }));
  return app;
}

function desktopEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { TITANHUB_DESKTOP: '1', HOST: '127.0.0.1', TITANHUB_LOCAL_TOKEN: TOKEN, ...overrides };
}

describe('desktop local capability session', () => {
  afterEach(() => {
    resetLocalSession();
  });

  it('accepts the launch token as the fixed local principal', async () => {
    initLocalSession(desktopEnv());
    const res = await buildApp().request('/private', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: LOCAL_USER_ID });
  });

  it('rejects missing, wrong, truncated and cloud JWT credentials in desktop mode', async () => {
    initLocalSession(desktopEnv());
    const app = buildApp();
    const jwt = await signUserToken('cloud-user');
    const attempts: Record<string, string>[] = [
      {},
      { Authorization: `Bearer ${crypto.randomBytes(32).toString('base64url')}` },
      { Authorization: `Bearer ${TOKEN.slice(0, 20)}` },
      { Authorization: `Bearer ${jwt}` },
      { Authorization: TOKEN },
    ];
    for (const headers of attempts) {
      const res = await app.request('/private', { headers });
      expect(res.status).toBe(401);
    }
  });

  it('fails closed when desktop mode is flagged but no session was initialised', async () => {
    const previous = process.env.TITANHUB_DESKTOP;
    process.env.TITANHUB_DESKTOP = '1';
    try {
      const res = await buildApp().request('/private', {
        headers: { Authorization: `Bearer ${await signUserToken('u1')}` },
      });
      expect(res.status).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.TITANHUB_DESKTOP;
      else process.env.TITANHUB_DESKTOP = previous;
    }
  });

  it('refuses to start desktop mode without a strong token or with a non-loopback bind', () => {
    expect(() => initLocalSession(desktopEnv({ TITANHUB_LOCAL_TOKEN: undefined }))).toThrow();
    expect(() => initLocalSession(desktopEnv({ TITANHUB_LOCAL_TOKEN: 'short' }))).toThrow();
    expect(() => initLocalSession(desktopEnv({ HOST: '0.0.0.0' }))).toThrow();
  });

  it('removes the token from the environment so spawned children cannot inherit it', () => {
    const env = desktopEnv();
    initLocalSession(env);
    expect(env.TITANHUB_LOCAL_TOKEN).toBeUndefined();
    expect(verifyLocalToken(TOKEN)).toBe(true);
  });

  it('keeps cloud JWT behaviour and never accepts a local token outside desktop mode', async () => {
    initLocalSession({ TITANHUB_USE_SQLITE: '1', TITANHUB_LOCAL_TOKEN: TOKEN });
    const app = buildApp();
    const jwtRes = await app.request('/private', {
      headers: { Authorization: `Bearer ${await signUserToken('cloud-user')}` },
    });
    expect(jwtRes.status).toBe(200);
    expect(await jwtRes.json()).toEqual({ userId: 'cloud-user' });

    const localRes = await app.request('/private', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(localRes.status).toBe(401);
    expect(verifyLocalToken(TOKEN)).toBe(false);
  });

  it('answers HMAC challenges bound to the actual listening address without revealing the token', () => {
    initLocalSession(desktopEnv());
    const nonce = crypto.randomBytes(32).toString('hex');
    expect(createLocalChallengeResponse(nonce)).toBeNull();

    setLocalSessionAddress('127.0.0.1', 41234);
    const response = createLocalChallengeResponse(nonce);
    expect(response).not.toBeNull();
    expect(response!.host).toBe('127.0.0.1');
    expect(response!.port).toBe(41234);
    expect(response!.proof).toBe(computeLocalChallengeProof(TOKEN, nonce, '127.0.0.1', 41234));
    expect(response!.proof).not.toBe(computeLocalChallengeProof(TOKEN, nonce, '127.0.0.1', 41235));
    expect(JSON.stringify(response)).not.toContain(TOKEN);

    expect(createLocalChallengeResponse('not-hex')).toBeNull();
  });

  it('strips capability and signing secrets from environments handed to external browsers', () => {
    const env = { PATH: '/bin', TITANHUB_LOCAL_TOKEN: TOKEN, JWT_SECRET: 'x', TOKEN_SECRET: 'y', HTTP_PROXY: 'http://p' };
    const sanitized = buildExternalProcessEnv(env);
    expect(sanitized).toEqual({ PATH: '/bin', HTTP_PROXY: 'http://p' });
    expect(env.TITANHUB_LOCAL_TOKEN).toBe(TOKEN);
  });

  it('does not answer challenges outside desktop mode', () => {
    initLocalSession({});
    setLocalSessionAddress('127.0.0.1', 41234);
    expect(createLocalChallengeResponse(crypto.randomBytes(32).toString('hex'))).toBeNull();
  });
});
