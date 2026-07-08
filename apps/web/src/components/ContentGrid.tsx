'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { AggregatedMediaItem } from '@titanhub/plugin-types';
import MediaCard from './MediaCard';
import { useHomeStore } from '../stores/homeStore';
import { animateEntranceStagger } from '../lib/animations';

function detailHref(item: AggregatedMediaItem): string | null {
  if (!item.pluginId) return null;
  return `/${item.mediaType}/${item.pluginId}/${item.id}`;
}

export default function ContentGrid() {
  const activeCategory = useHomeStore((state) => state.activeCategory);
  const items = useHomeStore((state) => state.items);
  const loading = useHomeStore((state) => state.loading);
  const error = useHomeStore((state) => state.error);
  const fetchCategory = useHomeStore((state) => state.fetchCategory);
  const loadMockFallback = useHomeStore((state) => state.loadMockFallback);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCategory(activeCategory);
  }, [activeCategory, fetchCategory]);

  useEffect(() => {
    if (items.length === 0) return;

    const ctx = animateEntranceStagger(containerRef.current, '.media-card-wrapper');

    return () => {
      if (ctx) ctx.revert();
    };
  }, [activeCategory, items]);

  if (loading && items.length === 0) {
    return (
      <div className="w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl p-3 bg-surface border border-border animate-pulse">
            <div className="aspect-[2/3] w-full rounded-xl bg-surfaceLight" />
            <div className="h-4 mt-3 rounded bg-surfaceLight w-3/4" />
            <div className="h-3 mt-2 rounded bg-surfaceLight w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-16 px-4 bg-surface border border-dashed border-red-500/20 rounded-2xl text-center">
        <div className="w-12 h-12 flex items-center justify-center rounded-full bg-red-500/10 text-red-500 mb-4 animate-bounce">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-textPrimary mb-2">服务聚合查询失败</h3>
        <p className="text-textSecondary text-sm max-w-md mb-6">{error}</p>
        <div className="flex flex-wrap gap-4 justify-center">
          <button
            onClick={() => fetchCategory(activeCategory, true)}
            className="px-5 py-2 bg-primary hover:bg-primary/90 text-white font-semibold rounded-xl text-sm transition-all shadow-md active:scale-95 cursor-pointer"
          >
            重试连接
          </button>
          <button
            onClick={() => loadMockFallback()}
            className="px-5 py-2 bg-surfaceLight hover:bg-surfaceLight/80 text-textSecondary font-semibold rounded-xl text-sm border border-border transition-all active:scale-95 cursor-pointer"
          >
            加载本地演示数据
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
      {items.map((item) => {
        const href = detailHref(item);
        const card = <MediaCard item={item} originBadge={item.pluginName} />;
        return (
          <div key={`${activeCategory}-${item.pluginId}-${item.id}`} className="media-card-wrapper">
            {href ? <Link href={href}>{card}</Link> : card}
          </div>
        );
      })}
    </div>
  );
}
