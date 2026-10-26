import { create } from 'zustand';
import { resolveCredentials, useLocalSessionStore } from './localSessionStore';
import { desktopBridge } from '@/lib/local-session';

export interface TrackingLog {
  id?: string;
  mediaId: string;
  pluginId: string;
  mediaType: 'anime' | 'manga' | 'novel' | 'movie';
  chapterNo: number;
  chapterId?: string;
  progress: number;
  position?: number | null;
  status: 'watching' | 'completed' | 'plan_to' | 'dropped';
  updatedAt?: string;
}

export interface FavoriteItem {
  id?: string;
  mediaId: string;
  pluginId: string;
  mediaType: 'anime' | 'manga' | 'novel' | 'movie';
  isDeleted?: boolean; // Used for soft deletion syncing
}

interface SyncState {
  trackingList: TrackingLog[];
  favoritesList: FavoriteItem[];
  error: string | null;
  errors: Partial<Record<'tracking' | 'favorites' | 'writes', string>>;
  pendingWrites: number;
  flushLocalWrites: () => Promise<boolean>;
  pullTracking: () => Promise<void>;
  pushTracking: (logs: TrackingLog[]) => Promise<void>;
  saveProgress: (log: Omit<TrackingLog, 'updatedAt'>) => Promise<void>;
  pullFavorites: () => Promise<void>;
  toggleFavorite: (item: Omit<FavoriteItem, 'isDeleted'>) => Promise<void>;
}

export function mediaKey(item: Pick<FavoriteItem, 'mediaType' | 'pluginId' | 'mediaId'>): string {
  return JSON.stringify([item.mediaType, item.pluginId, item.mediaId]);
}

type Credentials = NonNullable<ReturnType<typeof resolveCredentials>>;
type PendingWrite = { credentials: Credentials | null; path: string; body: unknown };
const pending: PendingWrite[] = [];
let serial: Promise<unknown> = Promise.resolve();

async function credentialsForRequest() {
  if (desktopBridge() && !(await useLocalSessionStore.getState().initialize())) {
    throw new Error(useLocalSessionStore.getState().error || '本地资料初始化失败，请重试。');
  }
  return resolveCredentials();
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = serial.then(work, work);
  serial = next.catch(() => undefined);
  return next;
}

async function request(credentials: Credentials, path: string, body?: unknown) {
  const response = await fetch(`${credentials.apiBase}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${credentials.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) throw new Error(data.error || `资料保存或读取失败 (${response.status})`);
  return data;
}

function mergeTracking(list: TrackingLog[], incoming: TrackingLog[]): TrackingLog[] {
  const merged = new Map(list.map((item) => [mediaKey(item), item]));
  incoming.forEach((item) => merged.set(mediaKey(item), item));
  return [...merged.values()];
}

export const useSyncStore = create<SyncState>((set, get) => {
  const updateError = (scope: 'tracking' | 'favorites' | 'writes', message: string | null) => {
    set((state) => {
      const errors = { ...state.errors };
      if (message) errors[scope] = message;
      else delete errors[scope];
      return { errors, error: Object.values(errors).join('；') || null };
    });
  };
  const fail = (error: unknown, scope: 'tracking' | 'favorites' | 'writes' = 'writes') => {
    updateError(scope, error instanceof Error ? error.message : '本地资料操作失败，请重试。');
    throw error;
  };
  const drain = async () => {
    while (pending.length) {
      const item = pending[0];
      const credentials = item.credentials || await credentialsForRequest();
      if (!credentials) throw new Error('本地资料尚未连接，请重试。');
      item.credentials = credentials;
      await request(credentials, item.path, item.body);
      pending.shift();
      set({ pendingWrites: pending.length });
    }
    updateError('writes', null);
  };
  const write = (credentials: Credentials | null, path: string, body: unknown) => {
    pending.push({ credentials, path, body });
    set({ pendingWrites: pending.length });
    return enqueue(drain).catch(fail);
  };
  const pull = async (kind: 'tracking' | 'favorites') => {
    const credentials = await credentialsForRequest().catch((error) => fail(error, kind));
    if (!credentials) return;
    return enqueue(async () => {
      await drain();
      const data = await request(credentials, `/api/sync/${kind}`);
      if (!Array.isArray(data[kind])) throw new Error('资料响应格式无效，请重试。');
      if (kind === 'tracking') {
        const edits = pending.filter((item) => item.path === '/api/sync/tracking').flatMap((item) => (item.body as { tracking: TrackingLog[] }).tracking);
        set({ trackingList: mergeTracking(data.tracking, edits) });
      } else {
        const list = new Map<string, FavoriteItem>(data.favorites.filter((item: FavoriteItem) => !item.isDeleted).map((item: FavoriteItem) => [mediaKey(item), item]));
        pending.filter((item) => item.path === '/api/sync/favorites').forEach((item) => {
          (item.body as { favorites: FavoriteItem[] }).favorites.forEach((favorite) => {
            if (favorite.isDeleted) list.delete(mediaKey(favorite));
            else list.set(mediaKey(favorite), favorite);
          });
        });
        set({ favoritesList: [...list.values()] });
      }
      updateError(kind, null);
    }).catch((error) => fail(error, kind));
  };
  return {
    trackingList: [],
    favoritesList: [],
    error: null,
    errors: {},
    pendingWrites: 0,
    pullTracking: () => pull('tracking'),
    pullFavorites: () => pull('favorites'),
    flushLocalWrites: async () => {
      try {
        await enqueue(drain);
        return true;
      } catch (error) {
        updateError('writes', error instanceof Error ? error.message : '本地写入失败，请重试。');
        return false;
      }
    },
    pushTracking: async (logs) => {
      const credentials = resolveCredentials();
      if ((!credentials && !desktopBridge()) || !logs.length) return;
      const tracking = logs.map((log) => ({ ...log, updatedAt: log.updatedAt || new Date().toISOString() }));
      set({ trackingList: mergeTracking(get().trackingList, tracking) });
      await write(credentials, '/api/sync/tracking', { tracking });
    },
    saveProgress: async (log) => {
      const updatedLog = { ...log, updatedAt: new Date().toISOString() };
      set({ trackingList: mergeTracking(get().trackingList, [updatedLog]) });
      const credentials = resolveCredentials();
      if (!credentials && !desktopBridge()) return;
      pending.push({ credentials, path: '/api/sync/tracking', body: { tracking: [updatedLog] } });
      await write(credentials, '/api/history', {
        mediaId: log.mediaId, pluginId: log.pluginId, mediaType: log.mediaType,
        chapterId: log.chapterId ?? '', chapterNo: log.chapterNo, progress: log.progress,
      });
    },
    toggleFavorite: async (item) => {
      const credentials = resolveCredentials();
      if (!credentials && !desktopBridge()) throw new Error('请先登录或等待本地资料初始化。');
      const isFavorite = get().favoritesList.some((favorite) => mediaKey(favorite) === mediaKey(item));
      set({ favoritesList: isFavorite ? get().favoritesList.filter((favorite) => mediaKey(favorite) !== mediaKey(item)) : [...get().favoritesList, item] });
      await write(credentials, '/api/sync/favorites', { favorites: [{ ...item, isDeleted: isFavorite }] });
    },
  };
});
