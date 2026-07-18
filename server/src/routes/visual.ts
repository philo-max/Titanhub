import { Hono } from 'hono';
import { requireAuth } from '../auth/jwt';

const visual = new Hono();

// --- Rate limiter: simple in-memory sliding window ---
// Allows max 10 requests per IP per 60-second window
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;
const rateMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT - 1, resetAt: now + RATE_WINDOW_MS };
  }
  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT - entry.count, resetAt: entry.resetAt };
}

// Max image upload size: 10 MB (trace.moe accepts up to 25MB, 10MB is plenty for screenshots)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

// POST: Search anime by image (requires authentication + rate limited)
visual.post('/search', requireAuth, async (c) => {
  // --- Rate limiting ---
  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  const rl = rateLimit(clientIp);
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  c.header('X-RateLimit-Reset', String(Math.floor(rl.resetAt / 1000)));
  if (!rl.allowed) {
    return c.json(
      { error: 'Rate limit exceeded. Please wait before trying again.' },
      429,
    );
  }

  try {
    const body = await c.req.parseBody();

    const imageFile = body.image;

    if (!imageFile || !(imageFile instanceof File)) {
      return c.json({ error: 'Please upload a valid image file under field name "image".' }, 400);
    }

    // --- Server-side file size validation ---
    if (imageFile.size > MAX_IMAGE_SIZE) {
      return c.json(
        { error: `Image too large. Maximum allowed size is ${MAX_IMAGE_SIZE / 1024 / 1024}MB, got ${(imageFile.size / 1024 / 1024).toFixed(1)}MB.` },
        413,
      );
    }

    // Convert File to Blob/Buffer to construct Fetch-safe FormData
    const formData = new FormData();
    formData.append('image', imageFile);

    // Call trace.moe API with anilistInfo=1 to get titles and metadata
    const response = await fetch('https://api.trace.moe/search?anilistInfo=1', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('trace.moe response error:', errorText);
      return c.json({ error: `Trace.moe API responded with status ${response.status}` }, 500);
    }

    const data = (await response.json()) as any;
    return c.json({ success: true, ...data });
  } catch (err: any) {
    console.error('Visual search proxy error:', err);
    return c.json({ error: err.message || String(err) }, 500);
  }
});

export default visual;
