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
  error: string | null;
  cache: Partial<Record<Category, AggregatedMediaItem[]>>;
  setActiveCategory: (category: Category) => void;
  fetchCategory: (category: Category, forceRefresh?: boolean) => Promise<void>;
  loadMockFallback: () => void;
}

export const useHomeStore = create<HomeState>((set, get) => ({
  activeCategory: 'anime',
  items: [],
  loading: false,
  error: null,
  cache: {},

  setActiveCategory: (category) => {
    set({ activeCategory: category, error: null });
    get().fetchCategory(category);
  },

  fetchCategory: async (category, forceRefresh = false) => {
    const cached = get().cache[category];
    if (cached && !forceRefresh) {
      set({ items: cached, error: null });
      return;
    }

    set({ loading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/api/aggregate/home?type=${category}`);
      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length > 0) {
        set((state) => ({
          items: data.items,
          loading: false,
          error: null,
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

  loadMockFallback: () => {
    const category = get().activeCategory;
    const items = mockFallback(category);
    set((state) => ({
      items,
      error: null,
      cache: { ...state.cache, [category]: items },
    }));
  },
}));
