'use client';

import React, { use, useEffect, useState, useRef } from 'react';
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
  Maximize2,
} from 'lucide-react';
import { useSyncStore } from '@/stores/syncStore';
import { API_BASE } from '@/lib/config';

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

  // Centralized transition when changing pages in Horizontal Mode
  const prevPageRef = useRef(currentPage);
  useEffect(() => {
    if (mode === 'horizontal' && images.length > 0) {
      const isNext = currentPage > prevPageRef.current;
      const target = `.manga-page-${currentPage}`;
      const prevTarget = `.manga-page-${prevPageRef.current}`;

      const ctx = animateMangaPageTransition(prevTarget, target, isNext, document.body);

      prevPageRef.current = currentPage;

      // Save progress to store
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

      return () => {
        if (ctx) ctx.revert();
      };
    }
  }, [currentPage, mode, images.length, mediaId, pluginId, chapterId, chapters, saveProgress]);

  const handleNextPage = () => {
    if (currentPage < images.length - 1) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 0) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400">
        <Loader2 className="h-10 w-10 text-violet-500 animate-spin mb-4" />
        <p className="text-sm tracking-wider">正在隔离沙箱中解析并抓取漫画图片列表...</p>
      </div>
    );
  }

  if (error || images.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <Layers className="h-16 w-16 text-rose-500 mb-4" />
        <h2 className="text-2xl font-bold text-slate-200 mb-2">加载阅读器失败</h2>
        <p className="text-slate-400 max-w-md mb-6">{error || '抓取章节返回的图片链接为空。'}</p>
        <button
          onClick={() => router.back()}
          className="flex items-center bg-slate-900 border border-slate-800 text-slate-300 px-6 py-2.5 rounded-xl hover:border-slate-700 active:scale-95 transition-all text-sm font-medium"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回详情页
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative overflow-hidden font-sans">
      {/* Top toolbar */}
      <header className="z-40 flex justify-between items-center bg-slate-950/80 backdrop-blur-md border-b border-slate-900 px-6 py-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-4 w-[1px] bg-slate-800" />
          <h1 className="text-sm md:text-base font-semibold truncate max-w-[200px] md:max-w-sm text-slate-200">
            {chapters.find((c) => c.id === chapterId)?.title || chapterId}
          </h1>
        </div>

        <div className="flex items-center space-x-3">
          {/* Zoom controls */}
          <div className="hidden sm:flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs">
            <button
              onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
              className="p-1 text-slate-400 hover:text-white"
            >
              -
            </button>
            <span className="text-slate-300 w-10 text-center font-mono">{zoomLevel}%</span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(150, z + 10))}
              className="p-1 text-slate-400 hover:text-white"
            >
              +
            </button>
          </div>

          {/* Reader mode toggler */}
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-0.5">
            <button
              onClick={() => setMode('vertical')}
              className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${mode === 'vertical' ? 'bg-violet-500 text-white shadow-md shadow-violet-500/20' : 'text-slate-400 hover:text-white'}`}
            >
              卷轴
            </button>
            <button
              onClick={() => setMode('horizontal')}
              className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${mode === 'horizontal' ? 'bg-violet-500 text-white shadow-md shadow-violet-500/20' : 'text-slate-400 hover:text-white'}`}
            >
              单页
            </button>
          </div>

          {/* Chapter sidebar toggler */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:text-white text-slate-400 rounded-xl transition-all"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Main Canvas reading viewport */}
      <main className="flex-grow overflow-y-auto relative flex items-center justify-center p-4">
        {mode === 'vertical' ? (
          // Continuous Vertical Scroll List
          <div
            ref={imageContainerRef}
            className="flex flex-col items-center space-y-4 w-full"
            style={{ width: `${zoomLevel}%`, maxWidth: '700px' }}
          >
            {images.map((img, idx) => (
              <div
                key={idx}
                className="w-full bg-slate-900/40 border border-slate-900 rounded-2xl overflow-hidden relative"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img}
                  alt={`Page ${idx + 1}`}
                  className="w-full h-auto object-contain block opacity-0 transition-opacity duration-500"
                  onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
                />
                <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded text-[10px] font-mono text-slate-400">
                  {idx + 1} / {images.length}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Horizontal Sliding page reader
          <div className="relative w-full max-w-lg flex flex-col items-center justify-center h-[75vh]">
            <div className="w-full flex-grow relative flex items-center justify-center bg-slate-950 rounded-2xl border border-slate-900 overflow-hidden shadow-2xl">
              {images.map((img, idx) => (
                <div
                  key={idx}
                  className={`manga-page-${idx} absolute inset-0 flex items-center justify-center`}
                  style={{
                    display: idx === currentPage ? 'flex' : 'none',
                    width: '100%',
                    height: '100%',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img}
                    alt={`Page ${idx + 1}`}
                    className="max-w-full max-h-full object-contain block"
                    style={{ transform: `scale(${zoomLevel / 100})` }}
                  />
                </div>
              ))}

              {/* Slider Arrow Left */}
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 0}
                className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/60 hover:bg-black/80 disabled:opacity-30 text-white rounded-full backdrop-blur-sm transition-all"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>

              {/* Slider Arrow Right */}
              <button
                onClick={handleNextPage}
                disabled={currentPage === images.length - 1}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/60 hover:bg-black/80 disabled:opacity-30 text-white rounded-full backdrop-blur-sm transition-all"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </div>

            {/* Slider bottom progress bar */}
            <div className="mt-4 flex items-center justify-between w-full px-2 text-xs font-mono text-slate-400">
              <span>第 {currentPage + 1} 页</span>
              <div className="flex-grow mx-4 h-1 bg-slate-800 rounded-full overflow-hidden">
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
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Sidebar container */}
          <div className="relative w-80 bg-slate-900 border-l border-slate-800 h-full flex flex-col p-6 shadow-2xl animate-slide-in">
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
                  className={`w-full text-left px-4 py-3 rounded-xl text-xs font-medium border transition-all ${ch.id === chapterId ? 'bg-violet-500/10 border-violet-500/30 text-violet-400 font-bold' : 'bg-slate-950 border-slate-950 hover:border-slate-800 text-slate-400 hover:text-slate-200'}`}
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
