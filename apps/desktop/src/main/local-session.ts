import crypto from 'crypto';
import http from 'http';

export const LOCAL_SESSION_CHANNEL = 'session:local';
export const FLUSH_REQUEST_CHANNEL = 'app:flush-request';
export const FLUSH_RESULT_CHANNEL = 'app:flush-result';

const TOKEN_BYTES = 32;
const CHALLENGE_CONTEXT = 'titanhub-local-session';
const CHALLENGE_TIMEOUT_MS = 5000;
const MAX_CHALLENGE_BODY_BYTES = 4096;

export interface FrameLike {
  url: string;
  parent: unknown;
  routingId: number;
  processId: number;
}

export interface SenderEventLike {
  sender: unknown;
  senderFrame: FrameLike | null | undefined;
}

export interface SessionWindowLike {
  isDestroyed(): boolean;
  webContents: {
    mainFrame: Pick<FrameLike, 'routingId' | 'processId'>;
    send(channel: string, ...args: unknown[]): void;
  };
}

export interface IpcListenerLike {
  on(channel: string, listener: (...args: any[]) => void): unknown;
  removeListener(channel: string, listener: (...args: any[]) => void): unknown;
}

export function generateLocalToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

export function computeChallengeProof(token: string, nonce: string, host: string, port: number): string {
  return crypto
    .createHmac('sha256', token)
    .update(`${CHALLENGE_CONTEXT}:${nonce}:${host}:${port}`, 'utf8')
    .digest('hex');
}

function getJson(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > MAX_CHALLENGE_BODY_BYTES) req.destroy();
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(null);
    });
  });
}

export async function verifyBackendChallenge(
  backendUrl: string,
  token: string,
  timeoutMs = CHALLENGE_TIMEOUT_MS
): Promise<boolean> {
  let expected: URL;
  try {
    expected = new URL(backendUrl);
  } catch {
    return false;
  }
  const host = expected.hostname;
  const port = Number(expected.port);
  const nonce = crypto.randomBytes(32).toString('hex');
  const body = (await getJson(
    `${expected.origin}/api/local-session/challenge?nonce=${nonce}`,
    timeoutMs
  )) as { host?: unknown; port?: unknown; proof?: unknown } | null;

  if (!body || body.host !== host || body.port !== port || typeof body.proof !== 'string') {
    return false;
  }
  const expectedProof = Buffer.from(computeChallengeProof(token, nonce, host, port), 'utf8');
  const actualProof = Buffer.from(body.proof, 'utf8');
  return actualProof.length === expectedProof.length && crypto.timingSafeEqual(actualProof, expectedProof);
}

export function isTrustedSessionSender(
  event: SenderEventLike,
  win: SessionWindowLike | null | undefined,
  webUrl: string
): boolean {
  if (!win || win.isDestroyed()) return false;
  if (event.sender !== win.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame.parent) return false;
  const mainFrame = win.webContents.mainFrame;
  if (frame.routingId !== mainFrame.routingId || frame.processId !== mainFrame.processId) return false;
  try {
    return new URL(frame.url).origin === new URL(webUrl).origin;
  } catch {
    return false;
  }
}

export function requestRendererFlush(
  win: SessionWindowLike | null | undefined,
  ipc: IpcListenerLike,
  webUrl: string,
  timeoutMs: number
): Promise<boolean> {
  if (!win || win.isDestroyed()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    let timer: NodeJS.Timeout | null = null;
    const finish = (ok: boolean) => {
      if (timer) clearTimeout(timer);
      ipc.removeListener(FLUSH_RESULT_CHANNEL, onResult);
      resolve(ok);
    };
    const onResult = (event: SenderEventLike, id: unknown, ok: unknown) => {
      if (id !== requestId || !isTrustedSessionSender(event, win, webUrl)) return;
      finish(ok === true);
    };
    ipc.on(FLUSH_RESULT_CHANNEL, onResult);
    timer = setTimeout(() => finish(false), timeoutMs);
    try {
      win.webContents.send(FLUSH_REQUEST_CHANNEL, requestId);
    } catch {
      finish(false);
    }
  });
}
