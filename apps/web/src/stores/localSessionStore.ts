import { create } from 'zustand';
import { desktopBridge, LocalSession, parseLocalSession } from '@/lib/local-session';
import { getApiBase } from '@/lib/config';
import { useAuthStore } from './authStore';

interface LocalSessionState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  session: LocalSession | null;
  error: string | null;
  initialize: () => Promise<boolean>;
}

let initializing: Promise<boolean> | null = null;

export const useLocalSessionStore = create<LocalSessionState>((set, get) => ({
  status: 'idle',
  session: null,
  error: null,
  initialize: async () => {
    const bridge = desktopBridge();
    if (!bridge) return false;
    if (get().status === 'ready') return true;
    if (initializing) return initializing;
    set({ status: 'loading', error: null });
    initializing = (async () => {
      try {
        const session = parseLocalSession(await bridge.getLocalSession());
        if (!session || (bridge.apiBase !== undefined && bridge.apiBase !== session.apiBase)) {
          throw new Error('本地会话地址或令牌无效，请重试。');
        }
        set({ status: 'ready', session, error: null });
        return true;
      } catch (error) {
        set({ status: 'error', session: null, error: error instanceof Error ? error.message : '本地会话初始化失败。' });
        return false;
      }
    })();
    try {
      return await initializing;
    } finally {
      initializing = null;
    }
  },
}));

export function resolveCredentials(): { apiBase: string; token: string; mode: 'local' | 'cloud' } | null {
  if (desktopBridge()) {
    const { session, status } = useLocalSessionStore.getState();
    return status === 'ready' && session ? { ...session, mode: 'local' } : null;
  }
  const token = useAuthStore.getState().token;
  return token ? { apiBase: getApiBase(), token, mode: 'cloud' } : null;
}
