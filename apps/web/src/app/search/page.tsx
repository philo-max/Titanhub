'use client';

import React, { Suspense, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, Search, Camera, Upload, Film, X, ChevronRight } from 'lucide-react';
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

interface TraceMoeResult {
  anilist: {
    id: number;
    title: {
      romaji?: string;
      english?: string;
      native?: string;
    };
    synonyms?: string[];
    isAdult: boolean;
  };
  filename: string;
  episode: number | null;
  from: number;
  to: number;
  similarity: number;
  video: string;
  image: string;
}

function getBestTitle(anilist: any): string {
  if (!anilist) return '未知动漫';
  
  // Try to find Chinese title in synonyms first
  const chineseRegex = /[\u4e00-\u9fa5]/;
  if (anilist.synonyms) {
    const chineseSynonym = anilist.synonyms.find((syn: string) => chineseRegex.test(syn));
    if (chineseSynonym) return chineseSynonym;
  }
  
  const title = anilist.title;
  if (title) {
    if (title.native && chineseRegex.test(title.native)) return title.native;
    // Fallbacks
    return title.native || title.english || title.romaji || '未知动漫';
  }
  
  return '未知动漫';
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function compressImage(file: File, maxWidth = 640, maxHeight = 640): Promise<File> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new window.Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        }, 'image/jpeg', 0.85); // 85% JPEG quality
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

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

  // Visual Search state
  const [showVisualSearch, setShowVisualSearch] = useState(false);
  const [visualImage, setVisualImage] = useState<File | null>(null);
  const [visualPreview, setVisualPreview] = useState<string>('');
  const [visualLoading, setVisualLoading] = useState(false);
  const [visualResults, setVisualResults] = useState<TraceMoeResult[]>([]);
  const [visualError, setVisualError] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const res = await fetch(
          `${API_BASE}/api/aggregate/search?q=${encodeURIComponent(q)}&type=${type || 'anime'}`
        );
        const data = await res.json();
        if (!cancelled) {
          if (Array.isArray(data.items)) {
            setItems(data.items);
          }
          setSearched(true);
        }

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

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const compressed = await compressImage(file);
      triggerVisualSearch(compressed);
    }
  };

  const triggerVisualSearch = async (file: File) => {
    setVisualImage(file);
    setVisualPreview(URL.createObjectURL(file));
    setVisualLoading(true);
    setVisualResults([]);
    setVisualError('');

    try {
      const formData = new FormData();
      formData.append('image', file);

      const res = await fetch(`${API_BASE}/api/visual/search`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setVisualResults(data.result || []);
    } catch (err: any) {
      setVisualError(err.message || '识别失败，请检查网络后重试。');
    } finally {
      setVisualLoading(false);
    }
  };

  const applySearchResult = (title: string) => {
    setKeyword(title);
    setShowVisualSearch(false);
    router.replace(`/search?q=${encodeURIComponent(title)}&type=anime`);
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

        <div className="max-w-2xl">
          <form
            onSubmit={handleSubmit}
            className="flex items-center glass-surface border border-borderSubtle rounded-pill p-1.5 shadow-card"
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
            
            {/* Visual Search trigger button */}
            <button
              type="button"
              onClick={() => setShowVisualSearch(!showVisualSearch)}
              title="以图搜番"
              className={`p-2 rounded-full mr-2 transition-all cursor-pointer ${showVisualSearch ? 'bg-primary/20 text-primary' : 'text-textSecondary hover:text-textPrimary hover:bg-surfaceLight'}`}
            >
              <Camera className="h-5 w-5" />
            </button>

            <button
              type="submit"
              className="px-5 py-2.5 bg-primary hover:bg-primaryHover text-white text-sm font-semibold rounded-pill transition-all duration-normal ease-out active:scale-95 cursor-pointer"
            >
              搜索
            </button>
          </form>

          {/* Invisible file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageChange}
            accept="image/*"
            className="hidden"
          />

          {/* Visual Search Expansion Panel */}
          {showVisualSearch && (
            <div className="mt-4 p-6 rounded-2xl bg-surface/50 border border-borderSubtle backdrop-blur-md shadow-xl animate-fade-in space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Film className="h-4 w-4 text-primary animate-pulse" />
                  <span className="text-sm font-extrabold text-textPrimary">二次元指纹检索仪</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowVisualSearch(false)}
                  className="p-1 rounded-lg text-textSecondary hover:text-textPrimary hover:bg-surfaceLight transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Upload Drop Zone / Preview */}
              {!visualPreview ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-border/80 rounded-2xl bg-background/20 hover:bg-surfaceLight/30 cursor-pointer transition group"
                >
                  <Upload className="h-8 w-8 text-textSecondary group-hover:text-primary group-hover:scale-110 transition-all mb-2" />
                  <p className="text-xs font-bold text-textPrimary">点击或拖拽上传动漫截图</p>
                  <p className="text-[10px] text-textSecondary mt-1">支持常见图片格式，建议裁剪无黑边</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Left image preview */}
                  <div className="flex flex-col">
                    <div className="relative group rounded-xl overflow-hidden border border-border/60 bg-background flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={visualPreview} alt="upload preview" className="max-h-36 w-full object-contain" />
                      <button
                        type="button"
                        onClick={() => {
                          setVisualImage(null);
                          setVisualPreview('');
                          setVisualResults([]);
                          setVisualError('');
                        }}
                        className="absolute right-2 top-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {visualImage && (
                      <p className="text-[10px] text-textSecondary truncate mt-2 font-mono" title={visualImage.name}>
                        {visualImage.name}
                      </p>
                    )}
                  </div>

                  {/* Right search list / loading */}
                  <div className="sm:col-span-2 flex flex-col justify-center min-h-[9rem]">
                    {visualLoading && (
                      <div className="flex flex-col items-center justify-center text-textSecondary gap-2">
                        <Loader2 className="h-6 w-6 text-primary animate-spin" />
                        <span className="text-xs font-semibold">正在比对二次元物理特征指纹...</span>
                      </div>
                    )}

                    {visualError && (
                      <div className="text-xs text-rose-400 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center font-medium">
                        {visualError}
                      </div>
                    )}

                    {!visualLoading && !visualError && visualResults.length === 0 && (
                      <div className="text-xs text-textSecondary text-center font-medium">
                        上传截图以开始识番 (trace.moe 服务支持)
                      </div>
                    )}

                    {!visualLoading && visualResults.length > 0 && (
                      <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                        <p className="text-[10px] text-textSecondary font-bold">匹配到的动漫指纹 (相似度排序):</p>
                        {visualResults.slice(0, 3).map((res, index) => {
                          const bestTitle = getBestTitle(res.anilist);
                          const simPercent = Math.round(res.similarity * 100);
                          const isHighConfidence = res.similarity >= 0.85;

                          return (
                            <div
                              key={index}
                              className="flex items-center gap-3 p-2 rounded-xl bg-background/40 border border-border/40 hover:border-primary/40 transition group"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={res.image}
                                alt="screenshot"
                                className="w-16 h-10 object-cover rounded-lg flex-shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-bold truncate group-hover:text-primary transition-colors">
                                  {bestTitle}
                                </h4>
                                <p className="text-[10px] text-textSecondary mt-0.5">
                                  第 {res.episode ?? '1'} 集 · {formatTime(res.from)} 处
                                </p>
                              </div>
                              <div className="flex flex-col items-end gap-1.5">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${isHighConfidence ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                                  {simPercent}%
                                </span>
                                <button
                                  type="button"
                                  onClick={() => applySearchResult(bestTitle)}
                                  className="flex items-center gap-0.5 text-[10px] font-bold text-primary hover:opacity-80 transition cursor-pointer"
                                >
                                  传送
                                  <ChevronRight className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

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
                {items.map((item: any) => {
                  const metaSource = item.sources?.find((s: any) => s.isMetadata);
                  const defaultSource = metaSource || item.sources?.[0];
                  if (!defaultSource) return null;
                  
                  const badge = metaSource ? '聚合数据' : (defaultSource.pluginName || '未知');
                  const isInfoSource = metaSource ? true : false;
                  
                  return (
                    <Link
                      key={`${item.id}`}
                      href={`/${item.mediaType}/${defaultSource.pluginId}/${defaultSource.mediaId}`}
                    >
                      <MediaCard item={item} originBadge={badge} isInfoSource={isInfoSource} />
                    </Link>
                  );
                })}
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
