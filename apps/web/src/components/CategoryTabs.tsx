'use client';

import React, { useEffect, useRef, useState } from 'react';
import { mockCategories, Category } from '../lib/mockData';
import { useHomeStore } from '../stores/homeStore';
import { animateCategoryTabIndicator } from '../lib/animations';
import { API_BASE } from '../lib/config';

const CATEGORY_LABELS: Record<Category, string> = {
  anime: '动漫',
  manga: '漫画',
  novel: '小说',
  movie: '影视',
};

export default function CategoryTabs() {
  const activeCategory = useHomeStore((state) => state.activeCategory);
  const setActiveCategory = useHomeStore((state) => state.setActiveCategory);
  const selectedSourceId = useHomeStore((state) => state.selectedSourceId);
  const setSelectedSourceId = useHomeStore((state) => state.setSelectedSourceId);
  const [plugins, setPlugins] = useState<{ id: string; name: string; types: string[]; isActive: boolean }[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/plugins`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.plugins)) {
          setPlugins(data.plugins);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const activeIndex = mockCategories.indexOf(activeCategory);
    const activeTab = tabsRef.current[activeIndex];
    animateCategoryTabIndicator(indicatorRef.current, activeTab);
  }, [activeCategory]);

  const categorySources = plugins.filter(
    (p) => p.isActive && Array.isArray(p.types) && p.types.includes(activeCategory)
  );

  return (
    <div className="w-full flex flex-col items-center py-6 gap-4" ref={containerRef}>
      <div className="relative flex items-center glass-surface border border-borderSubtle p-1.5 rounded-pill shadow-card">
        {/* Animated Background Indicator */}
        <div
          ref={indicatorRef}
          className="absolute left-0 top-1.5 bottom-1.5 bg-gradient-to-r from-primary to-secondary rounded-pill shadow-lg"
          style={{ willChange: 'transform, width' }}
        />

        {/* Tab Buttons */}
        {mockCategories.map((category, index) => {
          const isActive = category === activeCategory;
          return (
            <button
              key={category}
              ref={(el) => {
                tabsRef.current[index] = el;
              }}
              onClick={() => setActiveCategory(category)}
              className={`relative z-10 px-5 py-2 sm:px-7 sm:py-2.5 rounded-pill text-sm font-medium transition-colors duration-normal ease-out ${
                isActive ? 'text-white drop-shadow-md' : 'text-textSecondary hover:text-textPrimary'
              }`}
            >
              {CATEGORY_LABELS[category]}
            </button>
          );
        })}
      </div>

      {categorySources.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 max-w-4xl">
          <button
            type="button"
            onClick={() => setSelectedSourceId(null)}
            className={`text-xs px-3 py-1.5 rounded-pill border transition-all cursor-pointer ${
              selectedSourceId === null
                ? 'bg-primary/20 border-primary text-primary font-semibold'
                : 'bg-surface/60 border-borderSubtle text-textSecondary hover:text-textPrimary'
            }`}
          >
            全部来源 ({categorySources.length})
          </button>
          {categorySources.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => setSelectedSourceId(source.id)}
              className={`text-xs px-3 py-1.5 rounded-pill border transition-all cursor-pointer ${
                selectedSourceId === source.id
                  ? 'bg-primary/20 border-primary text-primary font-semibold'
                  : 'bg-surface/60 border-borderSubtle text-textSecondary hover:text-textPrimary'
              }`}
            >
              {source.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
