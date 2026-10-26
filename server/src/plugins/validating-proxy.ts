import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

export type AddressResolver = (hostname: string) => Promise<string | null>;

export interface ValidatingProxy {
  url: string;
  close(): Promise<void>;
}

export const PROXY_DENIED_HEADER = 'x-titanhub-proxy-denied';
const MAX_OPEN_CONNECTIONS = 128;
const UPSTREAM_CONNECT_TIMEOUT_MS = 10000;
const HOP_BY_HOP_HEADERS = ['connection', 'proxy-connection', 'proxy-authorization', 'keep-alive', 'te', 'trailer', 'upgrade', 'transfer-encoding'];

function parseAuthority(authority: string): { hostname: string; port: number } | null {
  const match = /^(\[[0-9a-f:.]+\]|[^:\s/@]+):(\d{1,5})$/i.exec(authority);
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { hostname: match[1].replace(/^\[|\]$/g, '').toLowerCase(), port };
}

function deny(socket: Duplex, status: string): void {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export async function startValidatingProxy(resolveAddress: AddressResolver): Promise<ValidatingProxy> {
  const sockets = new Set<Duplex>();
  let closed = false;

  const track = (socket: Duplex): boolean => {
    if (closed || sockets.size >= MAX_OPEN_CONNECTIONS) return false;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return true;
  };

  const resolveTarget = async (hostname: string): Promise<string | null> => {
    try {
      return await resolveAddress(hostname);
    } catch {
      return null;
    }
  };

  const forwardHttp = async (req: IncomingMessage, res: ServerResponse) => {
    let target: URL;
    try {
      target = new URL(req.url || '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (target.protocol !== 'http:' || target.username || target.password) {
      res.writeHead(400).end();
      return;
    }
    const address = await resolveTarget(target.hostname.replace(/^\[|\]$/g, '').toLowerCase());
    if (!address || closed) {
      res.writeHead(403, { connection: 'close', [PROXY_DENIED_HEADER]: '1' }).end();
      return;
    }
    const headers = { ...req.headers };
    for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
    headers.host = target.host;
    const upstream = httpRequest({
      host: address, port: Number(target.port || 80), method: req.method, path: `${target.pathname}${target.search}`,
      headers, agent: false, timeout: UPSTREAM_CONNECT_TIMEOUT_MS,
    }, response => {
      const responseHeaders = { ...response.headers };
      for (const name of HOP_BY_HOP_HEADERS) delete responseHeaders[name];
      res.writeHead(response.statusCode || 502, response.statusMessage, responseHeaders);
      response.pipe(res);
    });
    upstream.once('socket', socket => {
      if (!track(socket)) upstream.destroy();
    });
    upstream.once('timeout', () => upstream.destroy(new Error('Upstream timed out.')));
    upstream.once('error', () => {
      if (!res.headersSent) res.writeHead(502, { connection: 'close' });
      res.end();
    });
    res.once('close', () => upstream.destroy());
    req.pipe(upstream);
  };

  const server = createServer((req, res) => {
    void forwardHttp(req, res).catch(() => res.destroy());
  });

  server.on('connection', socket => {
    if (!track(socket)) socket.destroy();
  });

  server.on('connect', (req: IncomingMessage, client: Duplex, head: Buffer) => {
    void (async () => {
      const authority = parseAuthority(req.url || '');
      if (!authority) return deny(client, '400 Bad Request');
      const address = await resolveTarget(authority.hostname);
      if (!address || closed || client.destroyed) return deny(client, '403 Forbidden');
      const upstream: Socket = connect({ host: address, port: authority.port });
      if (!track(upstream)) {
        upstream.destroy();
        return deny(client, '503 Service Unavailable');
      }
      let established = false;
      upstream.setTimeout(UPSTREAM_CONNECT_TIMEOUT_MS, () => upstream.destroy());
      upstream.once('connect', () => {
        established = true;
        upstream.setTimeout(0);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.once('error', () => {
        if (established) client.destroy();
        else deny(client, '502 Bad Gateway');
      });
      upstream.once('close', () => client.destroy());
      client.once('error', () => upstream.destroy());
      client.once('close', () => upstream.destroy());
    })().catch(() => client.destroy());
  });

  server.on('clientError', (_error, socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      const done = new Promise<void>(resolve => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await done;
    },
  };
}
