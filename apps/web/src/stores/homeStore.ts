import { create } from 'zustand';
import { AggregatedMediaItem, type SourceInfo } from '@titanhub/plugin-types';
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

export interface AggregationSource {
  id: string;
  name: string;
  status: 'success' | 'empty' | 'error' | 'timeout' | 'unsupported' | 'configuration_required';
  displayName?: string;
  sourceInfo?: SourceInfo;
  code?: string;
  itemCount: number;
  message?: string;
}

interface HomeState {
  activeCategory: Category;
  selectedSourceId: string | null;
  items: AggregatedMediaItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  sources: AggregationSource[];
  page: number;
  hasMore: boolean;
  cache: Partial<Record<Category, AggregatedMediaItem[]>>;
  setActiveCategory: (category: Category) => void;
  setSelectedSourceId: (sourceId: string | null) => void;
  fetchCategory: (category: Category, forceRefresh?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  loadMockFallback: () => void;
}

const PAGE_SIZE = 20;
let latestRequest = 0;

export const useHomeStore = create<HomeState>((set, get) => ({
  activeCategory: 'anime',
  selectedSourceId: null,
  items: [],
  loading: false,
  loadingMore: false,
  error: null,
  sources: [],
  page: 1,
  hasMore: false,
  cache: {},

  setActiveCategory: (category) => {
    set({ activeCategory: category, selectedSourceId: null, error: null });
    get().fetchCategory(category);
  },

  setSelectedSourceId: (sourceId) => {
    const next = get().selectedSourceId === sourceId ? null : sourceId;
    set({ selectedSourceId: next, error: null });
    get().fetchCategory(get().activeCategory, true);
  },

  fetchCategory: async (category, forceRefresh = false) => {
    const request = ++latestRequest;
    const selectedSourceId = get().selectedSourceId;
    const cached = selectedSourceId ? undefined : get().cache[category];
    if (cached && !forceRefresh) {
      set({ items: cached, sources: [], loading: false, error: null, page: 1, hasMore: false });
      return;
    }

    set({ items: [], sources: [], loading: true, loadingMore: false, error: null, page: 1, hasMore: false });
    try {
      const params = new URLSearchParams({
        type: category,
        page: '1',
        pageSize: String(PAGE_SIZE),
      });
      if (selectedSourceId) params.set('pluginId', selectedSourceId);
      const res = await fetch(
        `${API_BASE}/api/aggregate/home?${params.toString()}`
      );
      const data = await res.json();
      if (request !== latestRequest || get().activeCategory !== category || get().selectedSourceId !== selectedSourceId) return;
      if (!res.ok) throw new Error(data.error || `聚合服务请求失败（HTTP ${res.status}）`);
      if (!Array.isArray(data.items)) throw new Error('聚合服务响应格式错误，请重试。');
      set({ sources: Array.isArray(data.sources) ? data.sources : [] });
      if (data.items.length > 0) {
        set((state) => ({
          items: data.items,
          loading: false,
          error: null,
          page: 1,
          hasMore: data.hasMore === true,
          cache: selectedSourceId ? state.cache : { ...state.cache, [category]: data.items },
        }));
      } else {
        throw new Error(data.error || (data.emptyReason === 'no_sources'
          ? '当前分类没有已启用来源，请前往来源管理启用来源。'
          : data.emptyReason === 'sources_failed'
            ? '所有已启用来源均加载失败，请查看来源状态后重试。'
            : '来源暂未返回内容，请稍后重试或在来源管理中选择其他来源。'));
      }
    } catch (err: any) {
      if (request !== latestRequest || get().activeCategory !== category) return;
      set({
        loading: false,
        error: err.message || '无法连接聚合服务，请重试。',
      });
    }
  },

  loadMore: async () => {
    const { activeCategory, selectedSourceId, page, loadingMore, hasMore, items } = get();
    if (loadingMore || !hasMore) return;

    set({ loadingMore: true });
    const nextPage = page + 1;
    try {
      const params = new URLSearchParams({
        type: activeCategory,
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      if (selectedSourceId) params.set('pluginId', selectedSourceId);
      const res = await fetch(
        `${API_BASE}/api/aggregate/home?${params.toString()}`
      );
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      const data = await res.json();
      if (get().activeCategory !== activeCategory || get().selectedSourceId !== selectedSourceId) return;
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
    ++latestRequest;
    const category = get().activeCategory;
    const items = mockFallback(category);
    set((state) => ({
      items,
      sources: [],
      loading: false,
      error: null,
      page: 1,
      hasMore: false,
      cache: { ...state.cache, [category]: items },
    }));
  },
}));
