import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import { EventEmitter } from 'events';
import { AddressInfo } from 'net';
import {
  generateLocalToken,
  computeChallengeProof,
  verifyBackendChallenge,
  isTrustedSessionSender,
  requestRendererFlush,
  FLUSH_REQUEST_CHANNEL,
  FLUSH_RESULT_CHANNEL,
} from './local-session';

const WEB_URL = 'http://127.0.0.1:3000';

function referenceProof(token: string, nonce: string, host: string, port: number): string {
  return crypto.createHmac('sha256', token).update(`titanhub-local-session:${nonce}:${host}:${port}`, 'utf8').digest('hex');
}

function makeWindow(options: { destroyed?: boolean } = {}) {
  const mainFrame = { routingId: 1, processId: 7, parent: null, url: `${WEB_URL}/tracking` };
  const sent: unknown[][] = [];
  const webContents = {
    mainFrame,
    send: (...args: unknown[]) => sent.push(args),
  };
  return {
    win: { isDestroyed: () => options.destroyed === true, webContents },
    mainFrame,
    sent,
  };
}

describe('desktop local session primitives', () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) await new Promise((r) => server!.close(r));
    server = null;
  });

  async function startChallengeServer(
    respond: (nonce: string, port: number) => { status: number; body: unknown }
  ): Promise<string> {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const port = (server!.address() as AddressInfo).port;
      const result =
        url.pathname === '/api/local-session/challenge'
          ? respond(url.searchParams.get('nonce') || '', port)
          : { status: 404, body: {} };
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('generates unique 32-byte base64url capability tokens', () => {
    const a = generateLocalToken();
    const b = generateLocalToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).not.toBe(b);
  });

  it('uses the same HMAC challenge formula as the backend', () => {
    const nonce = 'ab'.repeat(32);
    expect(computeChallengeProof('tok', nonce, '127.0.0.1', 4000)).toBe(referenceProof('tok', nonce, '127.0.0.1', 4000));
  });

  it('accepts only a backend that proves possession of this launch token on the expected address', async () => {
    const token = generateLocalToken();
    const url = await startChallengeServer((nonce, port) => ({
      status: 200,
      body: { host: '127.0.0.1', port, proof: referenceProof(token, nonce, '127.0.0.1', port) },
    }));
    expect(await verifyBackendChallenge(url, token)).toBe(true);
    expect(await verifyBackendChallenge(url, generateLocalToken())).toBe(false);
  });

  it('rejects impostors: health-only services, relayed proofs for another port and malformed answers', async () => {
    const token = generateLocalToken();
    const healthOnly = await startChallengeServer(() => ({ status: 404, body: { status: 'ok' } }));
    expect(await verifyBackendChallenge(healthOnly, token)).toBe(false);
    await new Promise((r) => server!.close(r));

    const relayed = await startChallengeServer((nonce, port) => ({
      status: 200,
      body: { host: '127.0.0.1', port: port + 1, proof: referenceProof(token, nonce, '127.0.0.1', port + 1) },
    }));
    expect(await verifyBackendChallenge(relayed, token)).toBe(false);
    await new Promise((r) => server!.close(r));

    const malformed = await startChallengeServer(() => ({ status: 200, body: { proof: 42 } }));
    expect(await verifyBackendChallenge(malformed, token)).toBe(false);
  });

  it('trusts only the main frame of the current app window on the real web origin', () => {
    const { win, mainFrame } = makeWindow();
    const ok = { sender: win.webContents, senderFrame: mainFrame };
    expect(isTrustedSessionSender(ok, win, WEB_URL)).toBe(true);

    expect(isTrustedSessionSender({ sender: {}, senderFrame: mainFrame }, win, WEB_URL)).toBe(false);
    expect(
      isTrustedSessionSender(
        { sender: win.webContents, senderFrame: { ...mainFrame, routingId: 2, parent: mainFrame } },
        win,
        WEB_URL
      )
    ).toBe(false);
    expect(
      isTrustedSessionSender(
        { sender: win.webContents, senderFrame: { ...mainFrame, url: 'http://127.0.0.1:3001/' } },
        win,
        WEB_URL
      )
    ).toBe(false);
    expect(
      isTrustedSessionSender(
        { sender: win.webContents, senderFrame: { ...mainFrame, url: 'https://evil.example/' } },
        win,
        WEB_URL
      )
    ).toBe(false);
    expect(isTrustedSessionSender({ sender: win.webContents, senderFrame: null }, win, WEB_URL)).toBe(false);
    expect(isTrustedSessionSender(ok, null, WEB_URL)).toBe(false);
    const destroyed = makeWindow({ destroyed: true });
    expect(
      isTrustedSessionSender({ sender: destroyed.win.webContents, senderFrame: destroyed.mainFrame }, destroyed.win, WEB_URL)
    ).toBe(false);
  });

  it('waits for a trusted renderer flush confirmation and ignores forged or stale replies', async () => {
    const { win, mainFrame, sent } = makeWindow();
    const ipc = new EventEmitter();
    const pending = requestRendererFlush(win, ipc, WEB_URL, 2000);
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(FLUSH_REQUEST_CHANNEL);
    const requestId = sent[0][1];

    ipc.emit(FLUSH_RESULT_CHANNEL, { sender: {}, senderFrame: mainFrame }, requestId, true);
    ipc.emit(FLUSH_RESULT_CHANNEL, { sender: win.webContents, senderFrame: mainFrame }, 'other-id', true);
    let settled = false;
    void pending.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    ipc.emit(FLUSH_RESULT_CHANNEL, { sender: win.webContents, senderFrame: mainFrame }, requestId, true);
    expect(await pending).toBe(true);
    expect(ipc.listenerCount(FLUSH_RESULT_CHANNEL)).toBe(0);
  });

  it('reports failure when the renderer reports unsaved data or does not answer in time', async () => {
    const { win, mainFrame, sent } = makeWindow();
    const ipc = new EventEmitter();
    const failed = requestRendererFlush(win, ipc, WEB_URL, 2000);
    ipc.emit(FLUSH_RESULT_CHANNEL, { sender: win.webContents, senderFrame: mainFrame }, sent[0][1], false);
    expect(await failed).toBe(false);

    expect(await requestRendererFlush(win, ipc, WEB_URL, 50)).toBe(false);
    expect(ipc.listenerCount(FLUSH_RESULT_CHANNEL)).toBe(0);
  });

  it('reports failure and removes the listener when the renderer cannot receive messages', async () => {
    const { win } = makeWindow();
    const ipc = new EventEmitter();
    win.webContents.send = () => {
      throw new Error('Renderer unavailable');
    };
    expect(await requestRendererFlush(win, ipc, WEB_URL, 50)).toBe(false);
    expect(ipc.listenerCount(FLUSH_RESULT_CHANNEL)).toBe(0);
  });

  it('treats an already-closed window as nothing left to flush', async () => {
    const { win } = makeWindow({ destroyed: true });
    expect(await requestRendererFlush(win, new EventEmitter(), WEB_URL, 50)).toBe(true);
    expect(await requestRendererFlush(null, new EventEmitter(), WEB_URL, 50)).toBe(true);
  });
});
