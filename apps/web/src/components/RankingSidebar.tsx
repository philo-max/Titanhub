'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { animateCounter } from '../lib/animations';
import { useHomeStore } from '../stores/homeStore';
import { API_BASE } from '../lib/config';

interface TrendingItem {
  id: string;
  title: string;
  category?: string;
  views?: string;
  pluginId?: string;
  mediaType?: string;
}

const CATEGORY_NAMES: Record<string, string> = {
  anime: '动漫',
  manga: '漫画',
  novel: '小说',
  movie: '影视',
};

interface MediaViewRow {
  mediaId: string;
  title: string;
  pluginId: string;
  mediaType: string;
  views: number;
}

export default function RankingSidebar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeCategory = useHomeStore((state) => state.activeCategory);
  const [items, setItems] = useState<TrendingItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    const fetchRanking = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/aggregate/ranking?type=${activeCategory}&limit=5`);
        if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
        const data = await res.json();
        const rows: MediaViewRow[] = Array.isArray(data.items) ? data.items : [];

        if (cancelled) return;

        if (rows.length > 0) {
          setItems(
            rows.map((row) => ({
              id: row.mediaId,
              title: row.title,
              category: CATEGORY_NAMES[row.mediaType] || row.mediaType,
              views: row.views > 0 ? `${row.views} 次浏览` : '热门推荐',
              pluginId: row.pluginId,
              mediaType: row.mediaType,
            }))
          );
          return;
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('[RankingSidebar] Failed to load real ranking data:', err);
      }

      if (cancelled) return;
      // No fallback to fake data — show empty state instead
      setItems([]);
    };

    fetchRanking();
    return () => {
      cancelled = true;
    };
  }, [activeCategory]);

  useEffect(() => {
    if (items.length > 0) {
      const numbers = containerRef.current?.querySelectorAll('.ranking-number');
      numbers?.forEach((el, index) => {
        animateCounter(el as HTMLElement, index + 1, index * 0.15);
      });
    }
  }, [items]);

  return (
    <div
      ref={containerRef}
      className="w-full lg:w-80 flex-shrink-0 bg-background border border-border rounded-3xl p-6 shadow-2xl sticky top-24 self-start"
    >
      <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-red-500">
          🔥
        </span>
        Trending
      </h2>
      <div className="flex flex-col gap-4">
        {items.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-textSecondary">暂无排行数据</p>
            <p className="text-xs text-textTertiary mt-1">浏览内容后将生成排行</p>
          </div>
        )}
        {items.map((item, index) => {
          const content = (
            <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer group w-full text-left">
              <div className="w-10 h-10 flex items-center justify-center rounded-full bg-surface group-hover:bg-primary/20 transition-colors border border-border group-hover:border-primary/30 flex-shrink-0">
                <span className="ranking-number text-xl font-black text-textSecondary group-hover:text-primary transition-colors">
                  {index + 1}
                </span>
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <h4 className="text-white font-semibold truncate group-hover:text-primary transition-colors">{item.title}</h4>
                <div className="flex items-center gap-2 text-xs text-textSecondary mt-1">
                  <span className="bg-surfaceLight px-2 py-0.5 rounded text-textPrimary font-medium">
                    {item.category}
                  </span>
                  <span>{item.views}</span>
                </div>
              </div>
            </div>
          );

          if (item.pluginId && item.mediaType) {
            const href = `/${item.mediaType}/${item.pluginId}/${item.id}`;
            return (
              <Link key={`${item.mediaType}-${item.pluginId}-${item.id}`} href={href} className="w-full block">
                {content}
              </Link>
            );
          }

          return (
            <div key={item.id} className="w-full">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
