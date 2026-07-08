import { sign, verify } from 'hono/jwt';
import { createMiddleware } from 'hono/factory';

const SECRET = process.env.TOKEN_SECRET || 'titanhub-dev-secret-change-me';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

if (!process.env.TOKEN_SECRET) {
  console.warn(
    '[auth] TOKEN_SECRET is not set. Using an insecure development default; set TOKEN_SECRET in production.'
  );
}

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

  const userId = await verifyUserToken(authHeader.slice('Bearer '.length));
  if (!userId) {
    return c.json({ error: 'Unauthorized. Invalid or expired token.' }, 401);
  }

  c.set('userId', userId);
  await next();
});
