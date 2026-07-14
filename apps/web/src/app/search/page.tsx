'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { AggregatedMediaItem, MediaType } from '@titanhub/plugin-types';
import MediaCard from '@/components/MediaCard';
import { API_BASE } from '@/lib/config';

const TYPE_TABS: { value: MediaType | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'anime', label: '动漫' },
  { value: 'manga', label: '漫画' },
  { value: 'novel', label: '小说' },
  { value: 'movie', label: '影视' },
];

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('q') || '';
  const type = searchParams.get('type') || '';

  const [keyword, setKeyword] = useState(q);
  const [items, setItems] = useState<AggregatedMediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    setKeyword(q);
    if (!q.trim()) {
      setItems([]);
      setSearched(false);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const url = `${API_BASE}/api/aggregate/search?q=${encodeURIComponent(q)}${
          type ? `&type=${type}` : ''
        }`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!cancelled) {
          setItems(data.items || []);
          setSearched(true);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || '搜索失败，请检查后端运行状态。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [q, type]);

  const navigate = (kw: string, nextType: string) => {
    const trimmed = kw.trim();
    if (!trimmed) return;
    router.replace(
      `/search?q=${encodeURIComponent(trimmed)}${nextType ? `&type=${nextType}` : ''}`
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(keyword, type);
  };

  return (
    <div className="min-h-screen bg-background text-textPrimary pb-24">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        <Link
          href="/"
          className="inline-flex items-center space-x-2 text-textSecondary hover:text-textPrimary transition mb-8 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">返回首页</span>
        </Link>

        <form
          onSubmit={handleSubmit}
          className="flex items-center bg-surface border border-border rounded-2xl p-2 shadow-xl max-w-2xl"
        >
          <Search className="h-5 w-5 text-textSecondary ml-3 shrink-0" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索番剧、漫画、小说、影视..."
            autoFocus
            className="flex-grow bg-transparent border-0 outline-none text-sm text-textPrimary px-3 py-2 placeholder-textSecondary"
          />
          <button
            type="submit"
            className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white text-sm font-bold rounded-xl transition active:scale-95 cursor-pointer"
          >
            搜索
          </button>
        </form>

        <div className="flex flex-wrap gap-2 mt-6">
          {TYPE_TABS.map((tab) => {
            const isActive = type === tab.value;
            return (
              <button
                key={tab.label}
                onClick={() => (q ? navigate(q, tab.value) : undefined)}
                className={`text-xs px-4 py-2 rounded-full border font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-primary border-primary text-white shadow-lg shadow-primary/25'
                    : 'bg-surface border-border text-textSecondary hover:text-textPrimary hover:border-surfaceLight'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-10">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-textSecondary">
              <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
              <p className="text-sm">正在跨插件聚合搜索「{q}」...</p>
            </div>
          )}

          {!loading && error && (
            <div className="max-w-md mx-auto p-6 rounded-2xl border border-rose-500/20 bg-rose-500/5 text-center">
              <h2 className="text-lg font-bold text-rose-400 mb-2">搜索失败</h2>
              <p className="text-sm text-textSecondary">{error}</p>
            </div>
          )}

          {!loading && !error && searched && items.length === 0 && (
            <div className="text-center py-20 text-textSecondary text-sm">
              没有找到与「{q}」相关的内容，换个关键词试试？
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            <>
              <p className="text-xs text-textSecondary mb-4">
                共 {items.length} 条结果，来自已启用的资源插件
              </p>
              <div className="w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                {items.map((item) => (
                  <Link
                    key={`${item.pluginId}-${item.id}`}
                    href={`/${item.mediaType}/${item.pluginId}/${item.id}`}
                  >
                    <MediaCard item={item} originBadge={item.pluginName} />
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
        </div>
      }
    >
      <SearchPageInner />
    </Suspense>
  );
}
