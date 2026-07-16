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
  const [searchProgress, setSearchProgress] = useState({ done: 0, total: 0 });

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
      setItems([]);
      setSearchProgress({ done: 0, total: 0 });
      try {
        // Fetch plugin list first to know how many sources to search
        const pluginsRes = await fetch(`${API_BASE}/api/plugins`);
        const pluginsData = await pluginsRes.json();
        const eligiblePlugins = (pluginsData.plugins || []).filter(
          (p: any) => p.isActive && (!type || p.types.includes(type))
        );
        setSearchProgress({ done: 0, total: eligiblePlugins.length });

        // Parallel search: fire all requests at once, render as each completes
        let completed = 0;
        await Promise.all(
          eligiblePlugins.map(async (plugin: any) => {
            try {
              const res = await fetch(
                `${API_BASE}/api/plugins/${plugin.id}/search?q=${encodeURIComponent(q)}`
              );
              const data = await res.json();
              const pluginItems: AggregatedMediaItem[] = (data.items || data || []).map(
                (item: any) => ({
                  ...item,
                  pluginId: plugin.id,
                  pluginName: plugin.name,
                  mediaType: type || plugin.types[0],
                  providesVideo: !/providesVideo\s*:\s*false/.test(plugin.code || ''),
                })
              );
              if (!cancelled && pluginItems.length > 0) {
                setItems((prev) => [...prev, ...pluginItems]);
              }
            } catch {
              // Individual plugin failure is non-fatal
            } finally {
              completed++;
              if (!cancelled) setSearchProgress({ done: completed, total: eligiblePlugins.length });
            }
          })
        );
        if (!cancelled) {
          setSearched(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSearchProgress({ done: 0, total: 0 });
        }
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
          className="flex items-center glass-surface border border-borderSubtle rounded-pill p-1.5 shadow-card max-w-2xl"
        >
          <Search className="h-5 w-5 text-textTertiary ml-4 shrink-0" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索番剧、漫画、小说、影视..."
            autoFocus
            className="flex-grow bg-transparent border-0 outline-none text-sm text-textPrimary px-3 py-2 placeholder-textTertiary"
          />
          <button
            type="submit"
            className="px-5 py-2.5 bg-primary hover:bg-primaryHover text-white text-sm font-semibold rounded-pill transition-all duration-normal ease-out active:scale-95 cursor-pointer"
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
                className={`text-xs px-4 py-2 rounded-pill border font-medium transition-all duration-normal ease-out cursor-pointer ${
                  isActive
                    ? 'bg-primary border-primary text-white shadow-card'
                    : 'bg-surface border-border text-textSecondary hover:text-textPrimary hover:border-surfaceLight'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-10">
          {loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-textSecondary">
              <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
              <p className="text-sm">正在搜索「{q}」...</p>
              {searchProgress.total > 0 && (
                <p className="text-xs text-textTertiary mt-2">
                  已查询 {searchProgress.done}/{searchProgress.total} 个源
                </p>
              )}
            </div>
          )}
          {loading && items.length > 0 && (
            <div className="flex items-center gap-2 mb-4 text-xs text-textTertiary">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>已查询 {searchProgress.done}/{searchProgress.total} 个源，{items.length} 条结果（加载中...）</span>
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

          {items.length > 0 && !error && (


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
                    <MediaCard item={item} originBadge={item.pluginName} isInfoSource={item.providesVideo === false} />
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
