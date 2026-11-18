import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MangaImageTokenStore,
  normalizeImagePages,
  serveMangaImage,
  toClientImageUrls,
} from './manga-images';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const API_BASE = 'http://127.0.0.1:3001';

interface SeenRequest {
  url: string;
  headers: IncomingMessage['headers'];
}

let server: Server;
let origin = '';
const seen: SeenRequest[] = [];
let releaseSlow: (() => void) | null = null;

function route(req: IncomingMessage, res: ServerResponse) {
  seen.push({ url: req.url || '', headers: req.headers });
  const path = (req.url || '').split('?')[0];
  if (path === '/img.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG);
  } else if (path === '/redirect') {
    res.writeHead(302, { location: '/img.png?hop=2' });
    res.end();
  } else if (path === '/redirect-private') {
    res.writeHead(302, { location: 'http://10.0.0.1/secret.png' });
    res.end();
  } else if (path === '/redirect-loop') {
    res.writeHead(302, { location: '/redirect-loop' });
    res.end();
  } else if (path === '/html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html></html>');
  } else if (path === '/declared-large') {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': '4096' });
    res.end(Buffer.alloc(4096));
  } else if (path === '/chunked-large') {
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    res.write(Buffer.alloc(600));
    setTimeout(() => res.end(Buffer.alloc(600)), 20);
  } else if (path === '/slow-body') {
    res.writeHead(200, { 'content-type': 'image/webp' });
    res.write(PNG);
    releaseSlow = () => res.end(PNG);
  } else if (path === '/forbidden') {
    res.writeHead(403, { 'content-type': 'image/png' });
    res.end();
  } else if (path !== '/hang') {
    res.writeHead(404);
    res.end();
  }
}

beforeAll(async () => {
  server = createServer(route);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function issue(store: MangaImageTokenStore, url: string, headers: Record<string, string> = { Referer: 'https://source.example/' }) {
  const [proxied] = toClientImageUrls([{ url, headers }], API_BASE, store);
  return proxied.slice(`${API_BASE}/api/manga-images/`.length);
}

async function errorOf(response: Response) {
  return { status: response.status, error: ((await response.json()) as { error: string }).error };
}

describe('normalizeImagePages', () => {
  it('accepts legacy strings and minimal descriptors with only whitelisted headers', () => {
    expect(normalizeImagePages([
      'https://cdn.example/a.jpg?sig=a%2Bb',
      { url: 'https://cdn.example/b.jpg' },
      { url: 'https://cdn.example/c.jpg', headers: { Referer: 'https://s.example/', 'User-Agent': 'UA', Cookie: 'sid=1', Host: 'evil', 'X-Other': '1' } },
      { url: 'https://cdn.example/d.jpg', headers: { Cookie: 'sid=1' } },
      { url: 'https://cdn.example/e.jpg', headers: { Referer: 'https://s.example/\r\nX-Injected: 1' } },
    ])).toEqual([
      { url: 'https://cdn.example/a.jpg?sig=a%2Bb' },
      { url: 'https://cdn.example/b.jpg' },
      { url: 'https://cdn.example/c.jpg', headers: { referer: 'https://s.example/', 'user-agent': 'UA' } },
      { url: 'https://cdn.example/d.jpg' },
      { url: 'https://cdn.example/e.jpg' },
    ]);
  });

  it('rejects malformed plugin image results explicitly', () => {
    expect(() => normalizeImagePages('https://cdn.example/a.jpg')).toThrow('array');
    expect(() => normalizeImagePages([{ headers: {} }])).toThrow('index 0');
    expect(() => normalizeImagePages(['ok', ''])).toThrow('index 1');
  });
});

describe('toClientImageUrls and token store', () => {
  it('returns plain URLs untouched and maps header pages to opaque same-site tokens', () => {
    const store = new MangaImageTokenStore();
    const signed = 'https://cdn.example/a.jpg?X-Amz-Signature=abc%2F%3D&Expires=1';
    const images = toClientImageUrls([signed, { url: 'https://cdn.example/b.jpg', headers: { Referer: 'https://s.example/' } }], API_BASE, store);
    expect(images[0]).toBe(signed);
    expect(images[1]).toMatch(/^http:\/\/127\.0\.0\.1:3001\/api\/manga-images\/[A-Za-z0-9_-]{24,}$/);
    expect(images[1]).not.toContain('cdn.example');
    const token = images[1].split('/').pop()!;
    expect(store.resolve(token)).toEqual({ url: 'https://cdn.example/b.jpg', headers: { referer: 'https://s.example/' } });
    expect(store.resolve('unknown-token')).toBeNull();
  });

  it('expires tokens and bounds the number of live entries', () => {
    let now = 1000;
    const store = new MangaImageTokenStore({ ttlMs: 100, maxEntries: 2, now: () => now });
    const first = issue(store, 'https://cdn.example/1.jpg');
    const second = issue(store, 'https://cdn.example/2.jpg');
    const third = issue(store, 'https://cdn.example/3.jpg');
    expect(store.resolve(first)).toBeNull();
    expect(store.resolve(second)?.url).toBe('https://cdn.example/2.jpg');
    now += 101;
    expect(store.resolve(third)).toBeNull();
  });
});

describe('serveMangaImage', () => {
  it('forwards whitelisted headers and requests signed URLs byte-for-byte', async () => {
    const store = new MangaImageTokenStore();
    const path = '/img.png?sig=a%2Bb%3D&exp=1700000000';
    const token = issue(store, origin + path, { Referer: 'https://source.example/chapter', 'User-Agent': 'MangaUA/1.0' });
    seen.length = 0;
    const response = await serveMangaImage(token, store);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(path);
    expect(seen[0].headers.referer).toBe('https://source.example/chapter');
    expect(seen[0].headers['user-agent']).toBe('MangaUA/1.0');
    expect(seen[0].headers.cookie).toBeUndefined();
  });

  it('follows redirects with headers and validates every hop', async () => {
    const store = new MangaImageTokenStore();
    seen.length = 0;
    const ok = await serveMangaImage(issue(store, origin + '/redirect'), store);
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
    expect(seen.map((r) => r.url)).toEqual(['/redirect', '/img.png?hop=2']);
    expect(seen[1].headers.referer).toBe('https://source.example/');

    expect(await errorOf(await serveMangaImage(issue(store, origin + '/redirect-private'), store)))
      .toMatchObject({ status: 403, error: expect.stringContaining('10.0.0.1') });
    expect((await serveMangaImage(issue(store, origin + '/redirect-loop'), store)).status).toBe(502);
  });

  it('blocks private and reserved targets before any request', async () => {
    const store = new MangaImageTokenStore();
    for (const target of ['http://192.168.1.10/a.png', 'http://169.254.169.254/latest', 'file:///etc/passwd']) {
      const result = await errorOf(await serveMangaImage(issue(store, target), store));
      expect(result.status).toBe(403);
    }
  });

  it('rejects non-image, upstream errors and oversized bodies', async () => {
    const store = new MangaImageTokenStore();
    const options = { maxBytes: 1024 };
    expect((await serveMangaImage(issue(store, origin + '/html'), store, options)).status).toBe(415);
    expect((await serveMangaImage(issue(store, origin + '/forbidden'), store, options)).status).toBe(502);
    expect((await serveMangaImage(issue(store, origin + '/declared-large'), store, options)).status).toBe(413);
    const chunked = await serveMangaImage(issue(store, origin + '/chunked-large'), store, options);
    expect(chunked.status).toBe(200);
    await expect(chunked.arrayBuffer()).rejects.toThrow();
  });

  it('streams the body before upstream finishes', async () => {
    const store = new MangaImageTokenStore();
    releaseSlow = null;
    const response = await serveMangaImage(issue(store, origin + '/slow-body'), store);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(Buffer.from(first.value!)).toEqual(PNG);
    expect(releaseSlow).toBeTypeOf('function');
    releaseSlow!();
    let rest = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += value.byteLength;
    }
    expect(rest).toBe(PNG.byteLength);
  });

  it('times out hanging upstreams', async () => {
    const store = new MangaImageTokenStore();
    const result = await errorOf(await serveMangaImage(issue(store, origin + '/hang'), store, { timeoutMs: 150 }));
    expect(result.status).toBe(504);
  });

  it('reports expired or unknown tokens clearly', async () => {
    let now = 0;
    const store = new MangaImageTokenStore({ ttlMs: 10, now: () => now });
    const token = issue(store, origin + '/img.png');
    now = 11;
    const expired = await errorOf(await serveMangaImage(token, store));
    expect(expired.status).toBe(410);
    expect(expired.error).toContain('过期');
    expect((await serveMangaImage('nope', store)).status).toBe(410);
  });
});
