'use client';

import React, { use, useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { animateMangaPageTransition } from '@/lib/animations';
import {
  ArrowLeft,
  BookOpen,
  Layers,
  ChevronLeft,
  ChevronRight,
  Menu,
  Loader2,
} from 'lucide-react';
import { useSyncStore } from '@/stores/syncStore';
import { API_BASE } from '@/lib/config';
import { playbackCache } from '@/lib/playbackCache';

interface Params {
  pluginId: string;
  mediaId: string;
  chapterId: string;
}

interface Chapter {
  id: string;
  title: string;
  chapterNo?: number;
}

interface LazyMangaImageProps {
  src: string;
  pageNum: number;
  total: number;
  zoomLevel: number;
  mode: 'horizontal' | 'vertical';
  isCurrentOrAdjacent: boolean;
}

function LazyMangaImage({
  src,
  pageNum,
  total,
  zoomLevel,
  mode,
  isCurrentOrAdjacent,
}: LazyMangaImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [retryCount, setRetryCount] = useState(0);

  // 1. IntersectionObserver for Vertical lazyload
  useEffect(() => {
    if (mode !== 'vertical') return;

    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setInView(true);
            observer.unobserve(container);
          }
        });
      },
      { rootMargin: '120% 0px' } // Load when 1.2 screen height away
    );

    observer.observe(container);
    return () => {
      if (container) {
        observer.unobserve(container);
      }
    };
  }, [mode]);

  // For horizontal mode, visibility is determined by index adjacency
  const shouldLoad = mode === 'vertical' ? inView : isCurrentOrAdjacent;

  const handleReload = () => {
    setStatus('loading');
    setRetryCount((prev) => prev + 1);
  };

  const imageSrc = shouldLoad
    ? (retryCount > 0 ? `${src}?retry=${retryCount}` : src)
    : '';

  return (
    <div
      ref={containerRef}
      className={`w-full flex items-center justify-center bg-surface/20 border border-borderSubtle/60 rounded-2xl overflow-hidden relative transition-all duration-300 ${
        mode === 'vertical' ? 'min-h-[450px]' : 'h-full'
      }`}
    >
      {shouldLoad ? (
        <>
          {status === 'loading' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-textTertiary bg-background/70 backdrop-blur-sm z-10">
              <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
              <span className="text-xs">第 {pageNum} 页正在全力加载...</span>
            </div>
          )}
          {status === 'failed' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-rose-400 bg-rose-950/30 backdrop-blur-sm p-4 z-10 text-center">
              <span className="text-sm font-semibold mb-3">第 {pageNum} 页加载失败</span>
              <button
                onClick={handleReload}
                className="px-4 py-2 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold hover:bg-rose-500/30 active:scale-95 transition-all cursor-pointer"
              >
                重新加载
              </button>
            </div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt={`Page ${pageNum}`}
            className={`max-w-full max-h-full object-contain block transition-opacity duration-300 ${
              status === 'loaded' ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            style={{
              transform: mode === 'horizontal' ? `scale(${zoomLevel / 100})` : undefined,
              transformOrigin: 'center center',
            }}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('failed')}
          />
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-textTertiary bg-background/40">
          <BookOpen className="h-6 w-6 mb-2 opacity-35" />
          <span className="text-xs font-mono">第 {pageNum} 页 / 共 {total} 页</span>
        </div>
      )}

      {status === 'loaded' && (
        <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded text-[10px] font-mono text-textSecondary z-20">
          {pageNum} / {total}
        </div>
      )}
    </div>
  );
}

export default function MangaReaderPage({ params }: { params: Promise<Params> }) {
  const { pluginId, mediaId, chapterId } = use(params);
  const router = useRouter();

  // Page states
  const [images, setImages] = useState<string[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Reader controls
  const [mode, setMode] = useState<'horizontal' | 'vertical'>('vertical');
  const [currentPage, setCurrentPage] = useState(0); // 0-indexed
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100); // percentage

  const { saveProgress } = useSyncStore();
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Fetch images and chapters
  useEffect(() => {
    const fetchReaderData = async () => {
      // 1. Try to read from prefetch cache first for instant load
      const cached = playbackCache.get(pluginId, chapterId);

      if (cached && cached.images && cached.images.length > 0) {
        setImages(cached.images);
        setLoading(false);
        setError('');

        // Fetch chapters list silently in the background
        try {
          const chaptersRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/chapters/${mediaId}`);
          const chaptersData = await chaptersRes.json();
          if (!chaptersData.error) {
            setChapters(chaptersData.chapters || []);
          }
        } catch (err) {
          console.warn('[MangaReader] Background chapters fetch failed:', err);
        }
        return;
      }

      setLoading(true);
      setError('');
      try {
        // Fetch manga pages list
        const imagesRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/images/${chapterId}`);
        const imagesData = await imagesRes.json();
        if (imagesData.error) throw new Error(imagesData.error);
        setImages(imagesData.images || []);

        // Fetch chapters list for navigator sidebar
        const chaptersRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/chapters/${mediaId}`);
        const chaptersData = await chaptersRes.json();
        if (!chaptersData.error) {
          setChapters(chaptersData.chapters || []);
        }
      } catch (err: any) {
        setError(err.message || '抓取章节漫画图片失败。');
      } finally {
        setLoading(false);
      }
    };

    fetchReaderData();
  }, [pluginId, mediaId, chapterId]);

  // Save progress progress synchronization
  useEffect(() => {
    if (images.length > 0) {
      saveProgress({
        mediaId,
        pluginId,
        mediaType: 'manga',
        chapterNo: chapters.find((c) => c.id === chapterId)?.chapterNo ?? 1,
        chapterId,
        progress: (currentPage + 1) / images.length,
        status: 'watching',
      });
    }
  }, [currentPage, images.length, mediaId, pluginId, chapterId, chapters, saveProgress]);

  // Centralized transition when changing pages in Horizontal Mode
  const prevPageRef = useRef(currentPage);
  useEffect(() => {
    if (mode === 'horizontal' && images.length > 0) {
      const isNext = currentPage > prevPageRef.current;
      const target = `.manga-page-${currentPage}`;
      const prevTarget = `.manga-page-${prevPageRef.current}`;

      const ctx = animateMangaPageTransition(prevTarget, target, isNext, document.body);
      prevPageRef.current = currentPage;

      return () => {
        if (ctx) ctx.revert();
      };
    }
  }, [currentPage, mode, images.length]);

  const handleNextPage = useCallback(() => {
    if (currentPage < images.length - 1) {
      setCurrentPage((prev) => prev + 1);
    }
  }, [currentPage, images.length]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 0) {
      setCurrentPage((prev) => prev - 1);
    }
  }, [currentPage]);

  // Keyboard pagination listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore key events when inputs or sidebar are active
      if (sidebarOpen) return;

      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === ' ') {
        e.preventDefault();
        handleNextPage();
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        handlePrevPage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidebarOpen, handleNextPage, handlePrevPage]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-textSecondary">
        <Loader2 className="h-10 w-10 text-violet-500 animate-spin mb-4" />
        <p className="text-sm tracking-wider">正在隔离沙箱中解析并抓取漫画图片列表...</p>
      </div>
    );
  }

  if (error || images.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <Layers className="h-16 w-16 text-rose-500 mb-4" />
        <h2 className="text-2xl font-bold text-textPrimary mb-2">加载阅读器失败</h2>
        <p className="text-textSecondary max-w-md mb-6">{error || '抓取章节返回的图片链接为空。'}</p>
        <button
          onClick={() => router.back()}
          className="flex items-center bg-surface border border-borderSubtle text-textSecondary px-6 py-2.5 rounded-xl hover:border-border active:scale-95 transition-all text-sm font-medium cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回详情页
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-textPrimary flex flex-col relative overflow-hidden font-sans select-none">
      {/* Top toolbar */}
      <header className="z-40 flex justify-between items-center bg-background/80 backdrop-blur-md border-b border-borderSubtle px-6 py-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="text-textSecondary hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-4 w-[1px] bg-surfaceLight" />
          <h1 className="text-sm md:text-base font-semibold truncate max-w-[200px] md:max-w-sm text-textPrimary">
            {(() => {
              const ch = chapters.find((c) => c.id === chapterId);
              if (ch?.title) return ch.title;
              if (ch?.chapterNo) return `第 ${ch.chapterNo} 话`;
              const idx = chapters.findIndex((c) => c.id === chapterId);
              return idx >= 0 ? `第 ${idx + 1} 话` : '阅读中';
            })()}
          </h1>
        </div>

        <div className="flex items-center space-x-3">
          {/* Zoom controls */}
          <div className="hidden sm:flex items-center space-x-2 bg-surface border border-borderSubtle rounded-lg px-2 py-1 text-xs">
            <button
              onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
              className="p-1 text-textSecondary hover:text-white cursor-pointer font-bold"
            >
              -
            </button>
            <span className="text-textSecondary w-10 text-center font-mono">{zoomLevel}%</span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(150, z + 10))}
              className="p-1 text-textSecondary hover:text-white cursor-pointer font-bold"
            >
              +
            </button>
          </div>

          {/* Reader mode toggler */}
          <div className="flex bg-surface border border-borderSubtle rounded-xl p-0.5">
            <button
              onClick={() => setMode('vertical')}
              className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                mode === 'vertical'
                  ? 'bg-violet-500 text-white shadow-md shadow-violet-500/20'
                  : 'text-textSecondary hover:text-white'
              }`}
            >
              卷轴
            </button>
            <button
              onClick={() => setMode('horizontal')}
              className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                mode === 'horizontal'
                  ? 'bg-violet-500 text-white shadow-md shadow-violet-500/20'
                  : 'text-textSecondary hover:text-white'
              }`}
            >
              单页
            </button>
          </div>

          {/* Chapter sidebar toggler */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 bg-surface border border-borderSubtle hover:border-border hover:text-white text-textSecondary rounded-xl transition-all cursor-pointer"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Main Reading viewport */}
      <main className="flex-grow overflow-y-auto relative flex items-center justify-center p-4">
        {mode === 'vertical' ? (
          // Continuous Vertical Scroll List with Lazy Loading
          <div
            ref={imageContainerRef}
            className="flex flex-col items-center space-y-4 w-full"
            style={{ width: `${zoomLevel}%`, maxWidth: '700px' }}
          >
            {images.map((img, idx) => (
              <LazyMangaImage
                key={idx}
                src={img}
                pageNum={idx + 1}
                total={images.length}
                zoomLevel={zoomLevel}
                mode="vertical"
                isCurrentOrAdjacent={false}
              />
            ))}
          </div>
        ) : (
          // Horizontal Sliding page reader
          <div className="relative w-full max-w-xl flex flex-col items-center justify-center h-[75vh]">
            <div className="w-full flex-grow relative flex items-center justify-center bg-background rounded-2xl border border-borderSubtle overflow-hidden shadow-2xl">
              {/* Invisible touch hotspots for convenient desktop paging */}
              <div
                onClick={handlePrevPage}
                className="absolute left-0 top-0 bottom-0 w-1/4 z-30 cursor-w-resize"
                title="上一页"
              />
              <div
                onClick={handleNextPage}
                className="absolute right-0 top-0 bottom-0 w-1/4 z-30 cursor-e-resize"
                title="下一页"
              />

              {images.map((img, idx) => {
                const isCurrentOrAdjacent = Math.abs(idx - currentPage) <= 2;
                return (
                  <div
                    key={idx}
                    className={`manga-page-${idx} absolute inset-0 flex items-center justify-center`}
                    style={{
                      display: idx === currentPage ? 'flex' : 'none',
                      width: '100%',
                      height: '100%',
                    }}
                  >
                    <LazyMangaImage
                      src={img}
                      pageNum={idx + 1}
                      total={images.length}
                      zoomLevel={zoomLevel}
                      mode="horizontal"
                      isCurrentOrAdjacent={isCurrentOrAdjacent}
                    />
                  </div>
                );
              })}

              {/* Slider Arrow Left */}
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 0}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/60 hover:bg-black/80 disabled:opacity-30 text-white rounded-full backdrop-blur-sm transition-all z-40 cursor-pointer"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>

              {/* Slider Arrow Right */}
              <button
                onClick={handleNextPage}
                disabled={currentPage === images.length - 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/60 hover:bg-black/80 disabled:opacity-30 text-white rounded-full backdrop-blur-sm transition-all z-40 cursor-pointer"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </div>

            {/* Slider bottom progress bar */}
            <div className="mt-4 flex items-center justify-between w-full px-2 text-xs font-mono text-textSecondary">
              <span>第 {currentPage + 1} 页</span>
              <div className="flex-grow mx-4 h-1 bg-surfaceLight rounded-full overflow-hidden">
                <div
                  className="bg-violet-500 h-full transition-all duration-300"
                  style={{ width: `${((currentPage + 1) / images.length) * 100}%` }}
                />
              </div>
              <span>共 {images.length} 页</span>
            </div>
          </div>
        )}
      </main>

      {/* Chapters selection drawer sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex justify-end animate-fade-in">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Sidebar container */}
          <div className="relative w-80 bg-surface border-l border-borderSubtle h-full flex flex-col p-6 shadow-2xl animate-slide-in">
            <h3 className="text-base font-bold text-white mb-6 flex items-center space-x-2">
              <BookOpen className="h-5 w-5 text-violet-500" />
              <span>章节跳转</span>
            </h3>

            <div className="flex-grow overflow-y-auto space-y-2 pr-2">
              {chapters.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => {
                    setSidebarOpen(false);
                    router.push(`/manga/${pluginId}/${mediaId}/read/${ch.id}`);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                    ch.id === chapterId
                      ? 'bg-violet-500/10 border-violet-500/30 text-violet-400 font-bold'
                      : 'bg-background border-border hover:border-borderSubtle text-textSecondary hover:text-textPrimary'
                  }`}
                >
                  {ch.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

