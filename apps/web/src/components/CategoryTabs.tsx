'use client';

import React, { useEffect, useRef } from 'react';
import { mockCategories, Category } from '../lib/mockData';
import { useHomeStore } from '../stores/homeStore';
import { animateCategoryTabIndicator } from '../lib/animations';

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
    <div className="w-full flex justify-center py-10" ref={containerRef}>
      <div className="relative flex items-center bg-surfaceLight border border-border p-1.5 rounded-full shadow-xl">
        {/* Animated Background Indicator */}
        <div
          ref={indicatorRef}
          className="absolute left-0 top-1.5 bottom-1.5 bg-gradient-to-r from-primary to-secondary rounded-full shadow-lg"
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
              className={`relative z-10 px-6 py-2.5 sm:px-8 sm:py-3 rounded-full text-sm sm:text-base font-bold capitalize transition-colors duration-300 ${
                isActive ? 'text-white drop-shadow-md' : 'text-textSecondary hover:text-textPrimary'
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>
    </div>
  );
}
