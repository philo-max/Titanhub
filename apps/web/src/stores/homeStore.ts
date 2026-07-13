import { create } from 'zustand';
import { AggregatedMediaItem } from '@titanhub/plugin-types';
import { Category, mockMediaData } from '../lib/mockData';
import { API_BASE } from '../lib/config';

function mockFallback(category: Category): AggregatedMediaItem[] {
  return (mockMediaData[category] || []).map((item) => ({
    ...item,
    pluginId: '',
    pluginName: '演示数据',
    mediaType: category,
  }));
}

interface HomeState {
  activeCategory: Category;
  items: AggregatedMediaItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  page: number;
  hasMore: boolean;
  cache: Partial<Record<Category, AggregatedMediaItem[]>>;
  setActiveCategory: (category: Category) => void;
  fetchCategory: (category: Category, forceRefresh?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  loadMockFallback: () => void;
}

const PAGE_SIZE = 20;

export const useHomeStore = create<HomeState>((set, get) => ({
  activeCategory: 'anime',
  items: [],
  loading: false,
  loadingMore: false,
  error: null,
  page: 1,
  hasMore: false,
  cache: {},

  setActiveCategory: (category) => {
    set({ activeCategory: category, error: null });
    get().fetchCategory(category);
  },

  fetchCategory: async (category, forceRefresh = false) => {
    const cached = get().cache[category];
    if (cached && !forceRefresh) {
      set({ items: cached, error: null, page: 1, hasMore: false });
      return;
    }

    set({ loading: true, error: null, page: 1, hasMore: false });
    try {
      const res = await fetch(
        `${API_BASE}/api/aggregate/home?type=${category}&page=1&pageSize=${PAGE_SIZE}`
      );
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length > 0) {
        set((state) => ({
          items: data.items,
          loading: false,
          error: null,
          page: 1,
          hasMore: data.hasMore === true,
          cache: { ...state.cache, [category]: data.items },
        }));
      } else {
        throw new Error('No active plugin nodes returned content for this category.');
      }
    } catch (err: any) {
      set({
        loading: false,
        error: err.message || 'Failed to fetch categories. Please check your backend connection.',
      });
    }
  },

  loadMore: async () => {
    const { activeCategory, page, loadingMore, hasMore, items } = get();
    if (loadingMore || !hasMore) return;

    set({ loadingMore: true });
    const nextPage = page + 1;
    try {
      const res = await fetch(
        `${API_BASE}/api/aggregate/home?type=${activeCategory}&page=${nextPage}&pageSize=${PAGE_SIZE}`
      );
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.items)) {
        set({
          items: [...items, ...data.items],
          page: nextPage,
          hasMore: data.hasMore === true,
          loadingMore: false,
        });
      } else {
        set({ loadingMore: false, hasMore: false });
      }
    } catch (err: any) {
      set({ loadingMore: false });
      console.warn('[loadMore] Failed:', err.message);
    }
  },

  loadMockFallback: () => {
    const category = get().activeCategory;
    const items = mockFallback(category);
    set((state) => ({
      items,
      error: null,
      page: 1,
      hasMore: false,
      cache: { ...state.cache, [category]: items },
    }));
  },
}));
