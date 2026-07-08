'use client';

import React, { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { animateScrollProgress, animateNovelParagraphsReveal } from '@/lib/animations';
import {
  ArrowLeft,
  BookOpen,
  Settings,
  Sun,
  Moon,
  Type,
  ChevronLeft,
  ChevronRight,
  Menu,
  Loader2,
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

type ReaderTheme = 'obsidian' | 'sepia' | 'mint' | 'light';

export default function NovelReaderPage({ params }: { params: Promise<Params> }) {
  const { pluginId, mediaId, chapterId } = use(params);
  const router = useRouter();

  // Content states
  const [content, setContent] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Reader Settings
  const [theme, setTheme] = useState<ReaderTheme>('obsidian');
  const [fontSize, setFontSize] = useState(18); // px
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans'>('serif');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { saveProgress } = useSyncStore();
  const lastSyncTimeRef = useRef<number>(0);
  const scrollIndicatorRef = useRef<HTMLDivElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);

  // Fetch novel text and chapters list
  useEffect(() => {
    const fetchReaderData = async () => {
      setLoading(true);
      setError('');
      try {
        // Fetch novel content
        const contentRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/novel/${chapterId}`);
        const contentData = await contentRes.json();
        if (contentData.error) throw new Error(`获取章节正文失败: ${contentData.error}`);
        setContent(contentData.content || '正文内容解析为空。');

        // Fetch chapters list for navigator sidebar
        const chaptersRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/chapters/${mediaId}`);
        const chaptersData = await chaptersRes.json();
        if (!chaptersData.error) {
          setChapters(chaptersData.chapters || []);
        } else {
          throw new Error(`获取目录列表失败: ${chaptersData.error}`);
        }
      } catch (err: any) {
        setError(err.message || '加载小说章节失败。');
      } finally {
        setLoading(false);
      }
    };

    fetchReaderData();
  }, [pluginId, mediaId, chapterId]);

  // Page Scroll Progress Indicator Driven by GSAP
  useEffect(() => {
    const handleScroll = () => {
      if (textContainerRef.current) {
        const element = document.documentElement;
        const totalHeight = element.scrollHeight - element.clientHeight;
        const scrollPercent = totalHeight > 0 ? (element.scrollTop / totalHeight) * 100 : 0;

        animateScrollProgress(scrollIndicatorRef.current, scrollPercent);

        // Sync progress every few scroll ticks or significant jumps
        const now = Date.now();
        if (now - lastSyncTimeRef.current > 5000) {
          // Sync at most every 5s
          lastSyncTimeRef.current = now;
          saveProgress({
            mediaId,
            pluginId,
            mediaType: 'novel',
            chapterNo: chapters.find((c) => c.id === chapterId)?.chapterNo ?? 1,
            chapterId,
            progress: scrollPercent / 100,
            status: 'watching',
          });
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loading, mediaId, pluginId, chapterId, chapters, saveProgress]);

  // GSAP Fade-in reveal on text loading
  useEffect(() => {
    if (!loading && content) {
      const ctx = animateNovelParagraphsReveal(textContainerRef.current, '.animate-paragraph');
      return () => {
        if (ctx) ctx.revert();
      };
    }
  }, [loading, content]);

  // Theme theme-specific Tailwind configurations
  const themeClasses: Record<
    ReaderTheme,
    { bg: string; text: string; card: string; border: string }
  > = {
    obsidian: {
      bg: 'bg-slate-950',
      text: 'text-slate-300',
      card: 'bg-slate-900 border-slate-800',
      border: 'border-slate-800',
    },
    sepia: {
      bg: 'bg-[#FBF0D9]',
      text: 'text-[#5F4625]',
      card: 'bg-[#F4E3C1] border-[#E8CE9D]',
      border: 'border-[#E8CE9D]',
    },
    mint: {
      bg: 'bg-[#DFF0D8]',
      text: 'text-[#2D5337]',
      card: 'bg-[#D0E9C6] border-[#BCDDB3]',
      border: 'border-[#BCDDB3]',
    },
    light: {
      bg: 'bg-white',
      text: 'text-slate-800',
      card: 'bg-slate-50 border-slate-200',
      border: 'border-slate-200',
    },
  };

  const activeTheme = themeClasses[theme];

  // Helper: split text by double newline to render separate paragraph DOM nodes
  const paragraphs = content.split('\n\n').filter((p) => p.trim().isNotEmpty);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400">
        <Loader2 className="h-10 w-10 text-violet-500 animate-spin mb-4" />
        <p className="text-sm tracking-wider">正在隔离沙箱中解析并抓取小说内容正文...</p>
      </div>
    );
  }

  if (error || paragraphs.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <BookOpen className="h-16 w-16 text-rose-500 mb-4 animate-bounce" />
        <h2 className="text-2xl font-bold text-slate-200 mb-2">加载阅读器失败</h2>
        <p className="text-slate-400 max-w-md mb-6">{error || '抓取章节返回的小说正文为空。'}</p>
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
    <div
      className={`min-h-screen ${activeTheme.bg} transition-colors duration-300 relative flex flex-col font-sans`}
    >
      {/* Scroll Progress Bar */}
      <div className="fixed top-0 left-0 w-full h-[3px] bg-black/10 z-50">
        <div
          ref={scrollIndicatorRef}
          className="h-full bg-gradient-to-r from-violet-600 to-cyan-500 w-0"
        />
      </div>

      {/* Top Header bar */}
      <header
        className={`z-40 fixed top-[3px] left-0 right-0 flex justify-between items-center ${theme === 'light' ? 'bg-white/80 border-slate-200' : 'bg-slate-950/80 border-slate-900'} backdrop-blur-md border-b px-6 py-4 transition-colors`}
      >
        <div className="flex items-center space-x-4">
          <button
            onClick={() => router.back()}
            className={`transition-colors ${theme === 'light' ? 'text-slate-600 hover:text-slate-950' : 'text-slate-400 hover:text-white'}`}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className={`h-4 w-[1px] ${theme === 'light' ? 'bg-slate-300' : 'bg-slate-800'}`} />
          <h1
            className={`text-sm md:text-base font-semibold truncate max-w-[200px] md:max-w-sm ${theme === 'light' ? 'text-slate-800' : 'text-slate-200'}`}
          >
            {chapters.find((c) => c.id === chapterId)?.title || chapterId}
          </h1>
        </div>

        <div className="flex items-center space-x-3">
          {/* Settings Panel Toggle */}
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className={`p-2 border rounded-xl transition-all ${theme === 'light' ? 'bg-slate-100 border-slate-200 hover:border-slate-300 text-slate-600' : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400'}`}
          >
            <Settings className="h-5 w-5" />
          </button>

          {/* Chapter sidebar toggler */}
          <button
            onClick={() => setSidebarOpen(true)}
            className={`p-2 border rounded-xl transition-all ${theme === 'light' ? 'bg-slate-100 border-slate-200 hover:border-slate-300 text-slate-600' : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-400'}`}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Settings popup panel */}
      {settingsOpen && (
        <div className="fixed top-20 right-6 z-40 w-72 p-5 rounded-2xl shadow-2xl border backdrop-blur-md bg-slate-950/95 border-slate-800 text-slate-200 animate-fade-in">
          <h3 className="text-sm font-bold mb-4 flex items-center space-x-2">
            <Type className="h-4 w-4 text-violet-500" />
            <span>阅读偏好设置</span>
          </h3>

          {/* Themes list */}
          <div className="mb-4">
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">
              背景背景
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['obsidian', 'sepia', 'mint', 'light'] as ReaderTheme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`h-8 rounded-lg border text-[10px] font-bold uppercase transition-all ${t === 'obsidian' ? 'bg-slate-950 text-slate-300 border-slate-800' : t === 'sepia' ? 'bg-[#FBF0D9] text-[#5F4625] border-[#E8CE9D]' : t === 'mint' ? 'bg-[#DFF0D8] text-[#2D5337] border-[#BCDDB3]' : 'bg-white text-slate-800 border-slate-300'} ${theme === t ? 'ring-2 ring-violet-500 ring-offset-2 ring-offset-slate-950' : ''}`}
                >
                  {t.substring(0, 3)}
                </button>
              ))}
            </div>
          </div>

          {/* Font Sizes */}
          <div className="mb-4">
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">
              字体大小
            </div>
            <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs">
              <button
                onClick={() => setFontSize((s) => Math.max(12, s - 2))}
                className="px-3 py-1 text-slate-400 hover:text-white font-bold"
              >
                A-
              </button>
              <span className="font-mono">{fontSize}px</span>
              <button
                onClick={() => setFontSize((s) => Math.min(32, s + 2))}
                className="px-3 py-1 text-slate-400 hover:text-white font-bold"
              >
                A+
              </button>
            </div>
          </div>

          {/* Font Families */}
          <div>
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider mb-2">
              字体样式
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() => setFontFamily('serif')}
                className={`py-1.5 rounded-lg border text-center font-serif transition-all ${fontFamily === 'serif' ? 'bg-violet-600 border-violet-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`}
              >
                宋体 / 衬线
              </button>
              <button
                onClick={() => setFontFamily('sans')}
                className={`py-1.5 rounded-lg border text-center font-sans transition-all ${fontFamily === 'sans' ? 'bg-violet-600 border-violet-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'}`}
              >
                黑体 / 无衬线
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Text Content area */}
      <main ref={textContainerRef} className="flex-grow pt-28 pb-32 px-6 overflow-y-auto">
        <article
          className={`max-w-2xl mx-auto leading-relaxed select-text tracking-wide ${fontFamily === 'serif' ? 'font-serif' : 'font-sans'}`}
          style={{
            fontSize: `${fontSize}px`,
            color: activeTheme.text,
          }}
        >
          {paragraphs.map((p, idx) => (
            <p
              key={idx}
              className="animate-paragraph mb-6 text-justify text-slate-900/90 leading-loose indent-8"
              style={{
                color: 'inherit',
                lineHeight: 1.85,
              }}
            >
              {p}
            </p>
          ))}
        </article>
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
          <div className="relative w-80 bg-slate-900 border-l border-slate-800 h-full flex flex-col p-6 shadow-2xl animate-slide-in text-slate-200">
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
                    router.push(`/novel/${pluginId}/${mediaId}/read/${ch.id}`);
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

// Extension implementation for Dart non-empty checking in typescript
declare global {
  interface String {
    isNotEmpty: boolean;
  }
}
Object.defineProperty(String.prototype, 'isNotEmpty', {
  get: function () {
    return this.length > 0;
  },
});
