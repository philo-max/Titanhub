import { useSyncStore } from '@/stores/syncStore';
import { DesktopBridge, WebDavConfigInput } from './local-session';
import { flushProgress } from './progress-flush';

export function buildWebDavConfig(config: Omit<WebDavConfigInput, 'password'>, password: string): WebDavConfigInput {
  let url: URL;
  try {
    url = new URL(config.url.trim());
  } catch {
    throw new Error('请输入有效的 WebDAV 服务器地址。');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new Error('服务器地址须为 HTTP 或 HTTPS，且不能包含密码、查询参数或片段。');
  }
  if (url.protocol === 'http:' && !config.allowInsecureHttp) {
    throw new Error('使用 HTTP 前，请明确勾选允许不加密连接。');
  }
  return { ...config, url: url.toString(), ...(password ? { password } : {}) };
}

export async function syncWebDavSettings(bridge: Pick<DesktopBridge, 'syncWebDav'>): Promise<unknown> {
  if (!bridge.syncWebDav) throw new Error('当前桌面版本不支持 WebDAV 同步。');
  flushProgress();
  if (!(await useSyncStore.getState().flushLocalWrites())) {
    throw new Error('本地资料尚未保存成功，请先重试本地写入。');
  }
  const result = await bridge.syncWebDav();
  await Promise.all([useSyncStore.getState().pullTracking(), useSyncStore.getState().pullFavorites()]);
  return result;
}
