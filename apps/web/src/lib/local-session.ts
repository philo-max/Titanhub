export interface LocalSession {
  apiBase: string;
  token: string;
}

export interface WebDavPublicConfig {
  url: string;
  username: string;
  allowInsecureHttp: boolean;
  hasPassword: boolean;
}

export interface WebDavConfigInput {
  url: string;
  username: string;
  allowInsecureHttp: boolean;
  password?: string;
}

export interface DesktopBridge {
  isDesktop: true;
  apiBase?: string;
  getLocalSession: () => Promise<unknown>;
  setFlushHandler?: (handler: () => Promise<boolean>) => void;
  getWebDavConfig?: () => Promise<WebDavPublicConfig>;
  saveWebDavConfig?: (config: WebDavConfigInput) => Promise<WebDavPublicConfig>;
  testWebDav?: () => Promise<unknown>;
  syncWebDav?: () => Promise<unknown>;
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { titanhubDesktop?: DesktopBridge }).titanhubDesktop;
  return bridge?.isDesktop === true ? bridge : null;
}

export function parseLocalSession(value: unknown): LocalSession | null {
  if (!value || typeof value !== 'object') return null;
  const { apiBase, token } = value as Partial<LocalSession>;
  if (typeof apiBase !== 'string' || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,}$/.test(token)) return null;
  try {
    const url = new URL(apiBase);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.origin !== apiBase) return null;
    return { apiBase, token };
  } catch {
    return null;
  }
}
