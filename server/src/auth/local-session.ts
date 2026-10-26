import crypto from 'node:crypto';

export const LOCAL_USER_ID = 'local';

const LOOPBACK_HOST = '127.0.0.1';
const MIN_TOKEN_LENGTH = 43;
const NONCE_PATTERN = /^[0-9a-f]{64}$/;
const CHALLENGE_CONTEXT = 'titanhub-local-session';
const SENSITIVE_ENV_KEYS = ['TITANHUB_LOCAL_TOKEN', 'JWT_SECRET', 'TOKEN_SECRET'];

interface LocalSessionState {
  token: string;
  tokenDigest: Buffer;
  host: string | null;
  port: number | null;
}

let state: LocalSessionState | null = null;

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function isDesktopAuthMode(): boolean {
  return state !== null || process.env.TITANHUB_DESKTOP === '1';
}

export function initLocalSession(env: NodeJS.ProcessEnv = process.env): void {
  state = null;
  if (env.TITANHUB_DESKTOP !== '1') return;

  const token = env.TITANHUB_LOCAL_TOKEN;
  const host = env.HOST || LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) {
    throw new Error(`[local-session] Desktop mode must bind ${LOOPBACK_HOST}, got "${host}".`);
  }
  if (!token || token.length < MIN_TOKEN_LENGTH) {
    throw new Error('[local-session] Desktop mode requires a launch capability in TITANHUB_LOCAL_TOKEN.');
  }

  state = { token, tokenDigest: digest(token), host: null, port: null };
  delete env.TITANHUB_LOCAL_TOKEN;
}

export function buildExternalProcessEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || SENSITIVE_ENV_KEYS.includes(key)) continue;
    result[key] = value;
  }
  return result;
}

export function resetLocalSession(): void {
  state = null;
}

export function setLocalSessionAddress(host: string, port: number): void {
  if (!state) return;
  state.host = host;
  state.port = port;
}

export function verifyLocalToken(candidate: string): boolean {
  if (!state || typeof candidate !== 'string' || candidate.length === 0) return false;
  return crypto.timingSafeEqual(digest(candidate), state.tokenDigest);
}

export function computeLocalChallengeProof(token: string, nonce: string, host: string, port: number): string {
  return crypto
    .createHmac('sha256', token)
    .update(`${CHALLENGE_CONTEXT}:${nonce}:${host}:${port}`, 'utf8')
    .digest('hex');
}

export function createLocalChallengeResponse(
  nonce: string
): { host: string; port: number; proof: string } | null {
  if (!state || state.host === null || state.port === null) return null;
  if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) return null;
  return {
    host: state.host,
    port: state.port,
    proof: computeLocalChallengeProof(state.token, nonce, state.host, state.port),
  };
}
