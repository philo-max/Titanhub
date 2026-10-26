import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useHomeStore } from './homeStore';

describe('useHomeStore', () => {
  beforeEach(() => {
    // Reset state before each test
    useHomeStore.setState({
      activeCategory: 'anime',
      items: [],
      loading: false,
      error: null,
      cache: {},
      sources: [],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], sources: [] }))));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('should initialize with default states', () => {
    const state = useHomeStore.getState();
    expect(state.activeCategory).toBe('anime');
    expect(state.items).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('should update active category and clear error', () => {
    useHomeStore.getState().setActiveCategory('manga');
    const state = useHomeStore.getState();
    expect(state.activeCategory).toBe('manga');
    expect(state.error).toBeNull();
  });

  it('should load mock fallback data correctly', () => {
    useHomeStore.getState().loadMockFallback();
    const state = useHomeStore.getState();
    expect(state.items.length).toBeGreaterThan(0);
    expect(state.error).toBeNull();
    expect(state.items[0].pluginName).toBe('演示数据');
  });

  it('shows server source failures instead of calling every failure an empty category', async () => {
    const sources = [{ id: 'broken', name: 'Broken source', status: 'error', itemCount: 0, message: '来源引擎初始化失败' }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], sources, emptyReason: 'sources_failed', error: '所有已启用来源均加载失败，请查看来源状态。' }))));
    await useHomeStore.getState().fetchCategory('anime', true);
    expect(useHomeStore.getState().error).toBe('所有已启用来源均加载失败，请查看来源状态。');
    expect(useHomeStore.getState().sources).toEqual(sources);
    expect(useHomeStore.getState().items).toEqual([]);
  });

  it('provides an actionable message when there are no enabled sources', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [], sources: [], emptyReason: 'no_sources' }))));
    await useHomeStore.getState().fetchCategory('anime', true);
    expect(useHomeStore.getState().error).toContain('来源管理');
  });

  it('keeps successful content while retaining partial source diagnostics', async () => {
    const sources = [{ id: 'broken', name: 'Broken', status: 'timeout', itemCount: 0 }];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'live', title: 'Real result' }], sources }))));
    await useHomeStore.getState().fetchCategory('anime', true);
    expect(useHomeStore.getState().items[0].id).toBe('live');
    expect(useHomeStore.getState().error).toBeNull();
    expect(useHomeStore.getState().sources).toEqual(sources);
  });

  it('reports HTTP failures using the response error and rejects malformed success data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '聚合服务暂时不可用' }), { status: 503 })));
    await useHomeStore.getState().fetchCategory('anime', true);
    expect(useHomeStore.getState().error).toBe('聚合服务暂时不可用');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    await useHomeStore.getState().fetchCategory('anime', true);
    expect(useHomeStore.getState().error).toContain('响应格式');
  });

  it('ignores a late category response after the user switches tabs', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockImplementation(async () => new Response(JSON.stringify({ items: [{ id: 'manga', title: 'Manga' }], sources: [] }))));
    const earlier = useHomeStore.getState().fetchCategory('anime', true);
    useHomeStore.getState().setActiveCategory('manga');
    await vi.waitFor(() => expect(useHomeStore.getState().items[0]?.id).toBe('manga'));
    finish(new Response(JSON.stringify({ items: [{ id: 'anime', title: 'Late anime' }], sources: [] })));
    await earlier;
    expect(useHomeStore.getState().activeCategory).toBe('manga');
    expect(useHomeStore.getState().items[0].id).toBe('manga');
  });
});
