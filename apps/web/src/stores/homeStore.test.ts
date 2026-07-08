import { describe, it, expect, beforeEach } from 'vitest';
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
    });
  });

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
});
