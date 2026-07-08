import { Hono } from 'hono';
import { db } from '../db/db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { signUserToken } from '../auth/jwt';

const auth = new Hono();

// POST: Register user
auth.post('/register', async (c) => {
  try {
    const { username, password } = await c.req.json();

    if (!username || !password || username.trim().length < 3 || password.length < 6) {
      return c.json({ error: 'Username must be >= 3 chars, password must be >= 6 chars.' }, 400);
    }

    // Check if user exists
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.username, username.trim()))
      .limit(1);
    if (existing.length > 0) {
      return c.json({ error: 'Username is already taken.' }, 400);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    const [inserted] = await db
      .insert(users)
      .values({
        username: username.trim(),
        password: passwordHash,
      })
      .returning({
        id: users.id,
        username: users.username,
      });

    return c.json({
      success: true,
      token: await signUserToken(inserted.id),
      user: inserted,
    });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

// POST: Login user
auth.post('/login', async (c) => {
  try {
    const { username, password } = await c.req.json();

    if (!username || !password) {
      return c.json({ error: 'Username and password are required.' }, 400);
    }

    // Fetch user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username.trim()))
      .limit(1);
    if (!user) {
      return c.json({ error: 'Invalid username or password.' }, 400);
    }

    // Verify password
    const match = await bcrypt.compare(password, user.password || '');
    if (!match) {
      return c.json({ error: 'Invalid username or password.' }, 400);
    }

    return c.json({
      success: true,
      token: await signUserToken(user.id),
      user: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default auth;
