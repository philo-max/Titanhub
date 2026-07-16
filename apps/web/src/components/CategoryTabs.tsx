'use client';

import React, { useEffect, useRef } from 'react';
import { mockCategories, Category } from '../lib/mockData';
import { useHomeStore } from '../stores/homeStore';
import { animateCategoryTabIndicator } from '../lib/animations';

const CATEGORY_LABELS: Record<Category, string> = {
  anime: '动漫',
  manga: '漫画',
  novel: '小说',
  movie: '影视',
};

export default function CategoryTabs() {
  const activeCategory = useHomeStore((state) => state.activeCategory);
  const setActiveCategory = useHomeStore((state) => state.setActiveCategory);

  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const activeIndex = mockCategories.indexOf(activeCategory);
    const activeTab = tabsRef.current[activeIndex];
    animateCategoryTabIndicator(indicatorRef.current, activeTab);
  }, [activeCategory]);

  return (
    <div className="w-full flex justify-center py-8" ref={containerRef}>
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
    </div>
  );
}
