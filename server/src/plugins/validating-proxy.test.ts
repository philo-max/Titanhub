import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { startValidatingProxy } from './validating-proxy';
import { PlaywrightSniffer } from './sniffer';

let origin: http.Server;
let originPort = 0;
const originHits: string[] = [];

beforeAll(async () => {
  origin = http.createServer((req, res) => {
    originHits.push(`${req.headers.host}${req.url}`);
    if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<script>setTimeout(() => fetch("/media/index.m3u8"), 200)</script>');
    } else if (req.url === '/media/index.m3u8') {
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXTINF:4,\nseg0.ts\n#EXT-X-ENDLIST');
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('origin-ok');
    }
  });
  await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', () => resolve()));
  originPort = (origin.address() as net.AddressInfo).port;
});

afterAll(async () => {
  await PlaywrightSniffer.close();
  await new Promise<void>(resolve => origin.close(() => resolve()));
});

function proxyGet(proxyUrl: string, target: string): Promise<{ status: number; body: string }> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: proxy.hostname, port: proxy.port, path: target, headers: { host: new URL(target).host } }, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function proxyConnect(proxyUrl: string, authority: string): Promise<{ statusLine: string; socket: net.Socket }> {
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(proxy.port), proxy.hostname, () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    socket.once('data', chunk => resolve({ statusLine: chunk.toString().split('\r\n')[0], socket }));
    socket.once('error', reject);
  });
}

describe('validating sniff proxy', () => {
  it('forwards only to the address returned by the resolver and preserves the Host header', async () => {
    const resolver = vi.fn(async (hostname: string) => (hostname === 'public-cdn.example' ? '127.0.0.1' : null));
    const proxy = await startValidatingProxy(resolver);
    try {
      const allowed = await proxyGet(proxy.url, `http://public-cdn.example:${originPort}/hello`);
      expect(allowed).toEqual({ status: 200, body: 'origin-ok' });
      expect(originHits).toContain(`public-cdn.example:${originPort}/hello`);
      const denied = await proxyGet(proxy.url, `http://intranet.example:${originPort}/secret`);
      expect(denied.status).toBe(403);
      expect(originHits.some(hit => hit.includes('/secret'))).toBe(false);
      expect(resolver).toHaveBeenCalledWith('intranet.example');
    } finally {
      await proxy.close();
    }
  });

  it('validates CONNECT tunnels, rejects malformed or denied authorities and fails closed on resolver errors', async () => {
    const proxy = await startValidatingProxy(async hostname => {
      if (hostname === 'throws.example') throw new Error('dns down');
      return hostname === 'tunnel.example' ? '127.0.0.1' : null;
    });
    try {
      const ok = await proxyConnect(proxy.url, `tunnel.example:${originPort}`);
      expect(ok.statusLine).toContain('200');
      ok.socket.destroy();
      for (const authority of [`169.254.169.254:80`, `throws.example:${originPort}`, 'no-port.example', 'bad.example:99999']) {
        const result = await proxyConnect(proxy.url, authority);
        expect(result.statusLine).toMatch(/40[03]/);
        result.socket.destroy();
      }
    } finally {
      await proxy.close();
    }
  });

  it('destroys open tunnels and stops listening on close', async () => {
    const proxy = await startValidatingProxy(async () => '127.0.0.1');
    const tunnel = await proxyConnect(proxy.url, `tunnel.example:${originPort}`);
    const closed = new Promise<void>(resolve => tunnel.socket.once('close', () => resolve()));
    await proxy.close();
    await closed;
    await expect(proxyGet(proxy.url, `http://tunnel.example:${originPort}/`)).rejects.toThrow();
  });

  it('routes every browser request through the resolver so a denied page cannot be sniffed', async () => {
    const pageUrl = `http://127.0.0.1:${originPort}/page`;
    const seen: string[] = [];
    PlaywrightSniffer.resolveAddress = async hostname => {
      seen.push(hostname);
      return null;
    };
    const hitsBefore = originHits.length;
    expect(await PlaywrightSniffer.sniff(`${pageUrl}?deny=1`)).toBe('');
    expect(seen).toContain('127.0.0.1');
    expect(originHits.length).toBe(hitsBefore);

    PlaywrightSniffer.resolveAddress = async hostname => (hostname === '127.0.0.1' ? '127.0.0.1' : null);
    expect(await PlaywrightSniffer.sniff(pageUrl)).toBe(`http://127.0.0.1:${originPort}/media/index.m3u8`);
  }, 60000);
});
