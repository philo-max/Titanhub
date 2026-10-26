import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  allowInsecureHttp: boolean;
}

interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface WebDavChild extends Pick<EventEmitter, 'on' | 'removeListener'> {
  connected: boolean;
  send(message: Record<string, unknown>, callback: (error: Error | null) => void): unknown;
}

export type WebDavOperation = 'webdav:test' | 'webdav:sync';
const REQUEST_TIMEOUT_MS = 90000;
const MAX_FIELD_LENGTH = 8192;

function validateConfig(value: unknown): WebDavConfig {
  if (!value || typeof value !== 'object') throw new Error('WebDAV 设置格式无效。');
  const input = value as Record<string, unknown>;
  if (typeof input.url !== 'string' || !input.url || input.url.length > MAX_FIELD_LENGTH
    || typeof input.username !== 'string' || input.username.length > MAX_FIELD_LENGTH
    || typeof input.allowInsecureHttp !== 'boolean'
    || (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > MAX_FIELD_LENGTH))) {
    throw new Error('WebDAV 设置格式无效。');
  }
  let url: URL;
  try { url = new URL(input.url); } catch { throw new Error('WebDAV 地址无效。'); }
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && input.allowInsecureHttp))) {
    throw new Error('WebDAV 必须使用 HTTPS；HTTP 需要明确允许，地址不能包含凭据或查询参数。');
  }
  return { url: url.toString(), username: input.username, password: input.password as string || '', allowInsecureHttp: input.allowInsecureHttp };
}

export class WebDavSettings {
  private readonly file: string;

  constructor(private readonly directory: string, private readonly encryption: Encryption) {
    this.file = path.join(directory, 'webdav-settings.encrypted.json');
  }

  private ensureEncryption(): void {
    if (!this.encryption.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，无法保存或读取 WebDAV 密码。');
  }

  getCredentials(): WebDavConfig {
    if (!fs.existsSync(this.file)) throw new Error('请先保存 WebDAV 设置。');
    this.ensureEncryption();
    try {
      const stored = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { version?: number; ciphertext?: string };
      if (stored.version !== 1 || typeof stored.ciphertext !== 'string') throw new Error();
      return validateConfig(JSON.parse(this.encryption.decryptString(Buffer.from(stored.ciphertext, 'base64'))));
    } catch {
      throw new Error('无法解密 WebDAV 设置，请重新配置。');
    }
  }

  read() {
    if (!fs.existsSync(this.file)) return { url: '', username: '', allowInsecureHttp: false, hasPassword: false };
    const config = this.getCredentials();
    return { url: config.url, username: config.username, allowInsecureHttp: config.allowInsecureHttp, hasPassword: Boolean(config.password) };
  }

  save(input: unknown) {
    this.ensureEncryption();
    const config = validateConfig(input);
    if (!config.password && fs.existsSync(this.file)) {
      const previous = this.getCredentials();
      if (config.url !== previous.url || config.username !== previous.username) {
        throw new Error('更换 WebDAV 地址或账号后，请重新输入密码。');
      }
      config.password = previous.password;
    }
    try {
      const ciphertext = this.encryption.encryptString(JSON.stringify(config)).toString('base64');
      fs.mkdirSync(this.directory, { recursive: true });
      const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, ciphertext }), { mode: 0o600 });
      fs.renameSync(temporary, this.file);
    } catch {
      throw new Error('WebDAV 凭据加密保存失败。');
    }
    return this.read();
  }
}

function publicResult(operation: WebDavOperation, value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('WebDAV 返回结果无效。');
  const data = value as Record<string, unknown>;
  const warnings = Array.isArray(data.warnings) && data.warnings.length > 0
    ? ['WebDAV 服务返回了兼容性提示，请避免多设备同时写入。'] : [];
  if (operation === 'webdav:test') {
    if (data.success !== true) throw new Error('WebDAV 连接测试失败。');
    return { success: true, warnings };
  }
  if (typeof data.pendingChanges !== 'boolean'
    || !(data.lastSuccessAt === null || (typeof data.lastSuccessAt === 'string'
      && /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(data.lastSuccessAt) && Number.isFinite(Date.parse(data.lastSuccessAt))))) {
    throw new Error('WebDAV 返回结果无效。');
  }
  return { lastSuccessAt: data.lastSuccessAt as string | null, pendingChanges: data.pendingChanges, warnings };
}

export function requestWebDav(
  child: WebDavChild | null,
  operation: WebDavOperation,
  config: WebDavConfig,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<ReturnType<typeof publicResult>> {
  if (!child?.connected) return Promise.reject(new Error('WebDAV 后端尚未就绪。'));
  if (operation !== 'webdav:test' && operation !== 'webdav:sync') return Promise.reject(new Error('WebDAV 操作无效。'));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const failure = new Error(operation === 'webdav:test' ? 'WebDAV 连接测试失败，请检查地址、凭据与服务状态。' : 'WebDAV 同步失败，请检查网络与服务状态后重试。');
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('message', onMessage);
      child.removeListener('exit', onExit);
      child.removeListener('error', onExit);
      child.removeListener('disconnect', onExit);
    };
    const onExit = () => { cleanup(); reject(failure); };
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const result = message as Record<string, unknown>;
      if (result.type !== 'webdav:result' || result.id !== id) return;
      cleanup();
      if (result.success !== true) { reject(failure); return; }
      try { resolve(publicResult(operation, result.data)); } catch { reject(failure); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('WebDAV 请求超时，请稍后重试。')); }, timeoutMs);
    child.on('message', onMessage);
    child.on('exit', onExit);
    child.on('error', onExit);
    child.on('disconnect', onExit);
    try { child.send({ type: operation, id, config }, (error) => { if (error) onExit(); }); } catch { onExit(); }
  });
}
