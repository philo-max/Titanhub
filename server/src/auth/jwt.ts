import { sign, verify } from 'hono/jwt';
import { createMiddleware } from 'hono/factory';
import { isDesktopAuthMode, verifyLocalToken, LOCAL_USER_ID } from './local-session';

const DEFAULT_SECRETS = ['titanhub-dev-secret-change-me', 'super-secret-jwt-key'];
const rawSecret = process.env.JWT_SECRET || process.env.TOKEN_SECRET;

if (process.env.NODE_ENV === 'production' && process.env.TITANHUB_DESKTOP !== '1') {
  if (!rawSecret || DEFAULT_SECRETS.includes(rawSecret)) {
    throw new Error(
      '[auth] Fatal: Insecure or missing JWT_SECRET / TOKEN_SECRET in production! Please set a strong random secret.'
    );
  }
} else if (!rawSecret || DEFAULT_SECRETS.includes(rawSecret)) {
  console.warn(
    '[auth] JWT_SECRET / TOKEN_SECRET is not set or using insecure default. Set JWT_SECRET in production.'
  );
}

const SECRET = rawSecret || 'titanhub-dev-secret-change-me';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function signUserToken(userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: userId, iat: now, exp: now + TOKEN_TTL_SECONDS }, SECRET, 'HS256');
}

export async function verifyUserToken(token: string): Promise<string | null> {
  try {
    const payload = await verify(token, SECRET, 'HS256');
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

type AuthEnv = { Variables: { userId: string } };

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized. Bearer token required.' }, 401);
  }

  if (isDesktopAuthMode()) {
    if (!verifyLocalToken(authHeader.slice('Bearer '.length))) {
      return c.json({ error: 'Unauthorized. Invalid local session.' }, 401);
    }
    c.set('userId', LOCAL_USER_ID);
    await next();
    return;
  }

  const userId = await verifyUserToken(authHeader.slice('Bearer '.length));
  if (!userId) {
    return c.json({ error: 'Unauthorized. Invalid or expired token.' }, 401);
  }

  c.set('userId', userId);
  await next();
});
