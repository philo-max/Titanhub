import { desktopBridge } from './local-session';
import { resolveCredentials, useLocalSessionStore } from '@/stores/localSessionStore';

export async function fetchPluginMutation(path: string, init: RequestInit = {}): Promise<Response> {
  if (desktopBridge() && !(await useLocalSessionStore.getState().initialize())) {
    throw new Error(useLocalSessionStore.getState().error || '本地会话初始化失败，请重试。');
  }
  const credentials = resolveCredentials();
  if (!credentials) throw new Error('请先登录后再管理来源。');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${credentials.token}`);
  return fetch(`${credentials.apiBase}${path}`, { ...init, headers });
}
