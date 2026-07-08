import { create } from 'zustand';
import { useAuthStore } from './authStore';
import { API_BASE } from '@/lib/config';

export interface TrackingLog {
  id?: string;
  mediaId: string;
  pluginId: string;
  mediaType: 'anime' | 'manga' | 'novel' | 'movie';
  chapterNo: number;
  chapterId?: string;
  progress: number;
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
  pullTracking: () => Promise<void>;
  pushTracking: (logs: TrackingLog[]) => Promise<void>;
  saveProgress: (log: Omit<TrackingLog, 'updatedAt'>) => Promise<void>;
  pullFavorites: () => Promise<void>;
  toggleFavorite: (item: Omit<FavoriteItem, 'isDeleted'>) => Promise<void>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  trackingList: [],
  favoritesList: [],

  pullTracking: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/sync/tracking`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        set({ trackingList: data.tracking });
      }
    } catch (e) {
      console.error('Failed to pull tracking:', e);
    }
  },

  pushTracking: async (logs: TrackingLog[]) => {
    const token = useAuthStore.getState().token;
    if (!token || logs.length === 0) return;

    try {
      const payload = logs.map((l) => ({
        ...l,
        updatedAt: l.updatedAt || new Date().toISOString(),
      }));
      const res = await fetch(`${API_BASE}/api/sync/tracking`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tracking: payload }),
      });
      const data = await res.json();
      if (data.success) {
        set({ trackingList: data.tracking });
      }
    } catch (e) {
      console.error('Failed to push tracking:', e);
    }
  },

  saveProgress: async (log) => {
    // 1. Update local state immediately
    const updatedLog: TrackingLog = { ...log, updatedAt: new Date().toISOString() };
    set((state) => {
      const existingIdx = state.trackingList.findIndex((t) => t.mediaId === log.mediaId);
      const newList = [...state.trackingList];
      if (existingIdx >= 0) {
        newList[existingIdx] = { ...newList[existingIdx], ...updatedLog };
      } else {
        newList.push(updatedLog);
      }
      return { trackingList: newList };
    });

    // 2. Async push to server
    await get().pushTracking([updatedLog]);
  },

  pullFavorites: async () => {
    const token = useAuthStore.getState().token;
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/sync/favorites`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        set({ favoritesList: data.favorites });
      }
    } catch (e) {
      console.error('Failed to pull favorites:', e);
    }
  },

  toggleFavorite: async (item) => {
    const state = get();
    const token = useAuthStore.getState().token;
    if (!token) return; // Prompt login in UI

    const isFav = state.favoritesList.some((f) => f.mediaId === item.mediaId);

    // Optimistic UI update
    set((s) => ({
      favoritesList: isFav
        ? s.favoritesList.filter((f) => f.mediaId !== item.mediaId)
        : [...s.favoritesList, { ...item }],
    }));

    // Async push to server
    try {
      const payload = { ...item, isDeleted: isFav };
      const res = await fetch(`${API_BASE}/api/sync/favorites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ favorites: [payload] }),
      });
      const data = await res.json();
      if (data.success) {
        set({ favoritesList: data.favorites });
      }
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
      // Rollback optimistic update
      await get().pullFavorites();
    }
  },
}));
