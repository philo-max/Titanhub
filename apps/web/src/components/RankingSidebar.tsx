'use client';

import React, { useEffect, useRef, useState } from 'react';
import { mockRanking } from '../lib/mockData';
import { animateCounter } from '../lib/animations';
import { API_BASE } from '@/lib/config';

interface TrendingItem {
  id: string;
  title: string;
  category?: string;
  views?: string;
  updateInfo?: string;
}

export default function RankingSidebar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<TrendingItem[]>(mockRanking.slice(0, 5));

  useEffect(() => {
    let active = true;
    const fetchTrending = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/plugins/bangumi/explore/anime`);
        const data = await res.json();
        if (active && data.items && Array.isArray(data.items) && data.items.length > 0) {
          const mapped = data.items.slice(0, 5).map((item: any) => ({
            id: item.id,
            title: item.title,
            category: '动漫',
            views: item.updateInfo || '今日热门',
          }));
          setItems(mapped);
        }
      } catch {
        // Fallback to mock rankings
      }
    };
    fetchTrending();
    return () => {
      active = false;
    };
  }, []);

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
        {items.map((item, index) => (
          <div
            key={item.id}
            className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors cursor-pointer group"
          >
            <div className="w-10 h-10 flex items-center justify-center rounded-full bg-surface group-hover:bg-primary/20 transition-colors border border-border group-hover:border-primary/30">
              <span className="ranking-number text-xl font-black text-textSecondary group-hover:text-primary transition-colors">
                {index + 1}
              </span>
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <h4 className="text-white font-semibold truncate">{item.title}</h4>
              <div className="flex items-center gap-2 text-xs text-textSecondary mt-1">
                <span className="bg-surfaceLight px-2 py-0.5 rounded text-textPrimary font-medium">
                  {item.category}
                </span>
                <span>{item.views}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
