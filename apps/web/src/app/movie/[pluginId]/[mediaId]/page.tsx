'use client';

import React, { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  animateDetailPageEntrance,
  animateDetailPageExitBack,
  animateDetailPageExitPlay,
} from '@/lib/animations';
import { ArrowLeft, Play, Calendar, User, Compass, HelpCircle, Loader2 } from 'lucide-react';
import { API_BASE, recordMediaView } from '@/lib/config';
import { playbackCache } from '@/lib/playbackCache';

interface Params {
  pluginId: string;
  mediaId: string;
}

interface MediaDetail {
  id: string;
  title: string;
  cover: string;
  description?: string;
  status?: string;
  author?: string;
  genres?: string[];
  lastUpdate?: string;
}

interface Chapter {
  id: string;
  title: string;
  chapterNo?: number;
}

export default function MovieDetailPage({ params }: { params: Promise<Params> }) {
  const { pluginId, mediaId } = use(params);
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  const viewRecordedRef = useRef<string | null>(null);
  const prefetchTimersRef = useRef<Record<string, NodeJS.Timeout>>({});
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        // Fetch detailed media metadata
        const detailRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/detail/${mediaId}`);
        const detailData = await detailRes.json();

        if (detailData.error) {
          throw new Error(detailData.error);
        }
        setDetail(detailData.detail);
        if (viewRecordedRef.current !== mediaId) {
          viewRecordedRef.current = mediaId;
          recordMediaView({
            mediaType: 'movie',
            mediaId,
            pluginId,
            title: detailData.detail.title,
            cover: detailData.detail.cover,
          });
        }

        // Fetch chapters list
        const chaptersRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/chapters/${mediaId}`);
        const chaptersData = await chaptersRes.json();

        if (chaptersData.error) {
          throw new Error(chaptersData.error);
        }
        setChapters(chaptersData.chapters || []);
      } catch (err: any) {
        setError(err.message || '获取数据失败，请检查后端运行状态。');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [pluginId, mediaId]);

  // GSAP Entrance Animations
  useEffect(() => {
    const timers = prefetchTimersRef.current;
    if (!loading && detail) {
      const ctx = animateDetailPageEntrance(pageRef.current);
      return () => {
        if (ctx) ctx.revert();
        // Clear all pending prefetch timers on unmount
        Object.values(timers).forEach(clearTimeout);
      };
    }
  }, [loading, detail]);

  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault();
    animateDetailPageExitBack(pageRef.current, () => {
      router.push('/');
    });
  };

  const handleChapterClick = (chapterId: string) => {
    if (prefetchTimersRef.current[chapterId]) {
      clearTimeout(prefetchTimersRef.current[chapterId]);
    }
    animateDetailPageExitPlay(pageRef.current, () => {
      router.push(`/movie/${pluginId}/${mediaId}/play/${chapterId}`);
    });
  };

  const handleChapterMouseEnter = (chapterId: string) => {
    if (prefetchTimersRef.current[chapterId]) return;
    prefetchTimersRef.current[chapterId] = setTimeout(() => {
      playbackCache.prefetch(pluginId, mediaId, chapterId, 'anime');
      delete prefetchTimersRef.current[chapterId];
    }, 150);
  };

  const handleChapterMouseLeave = (chapterId: string) => {
    if (prefetchTimersRef.current[chapterId]) {
      clearTimeout(prefetchTimersRef.current[chapterId]);
      delete prefetchTimersRef.current[chapterId];
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100">
        <Loader2 className="h-10 w-10 text-violet-400 animate-spin mb-4" />
        <p className="text-sm text-slate-400">正在与沙箱引擎通信并加载 ACG 详情...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-6 text-slate-100">
        <div className="max-w-md p-6 rounded-2xl border border-rose-500/20 bg-rose-500/5 text-center">
          <HelpCircle className="h-12 w-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-rose-400 mb-2">获取详情失败</h2>
          <p className="text-sm text-slate-400 mb-6">
            {error || '找不到插件源内容，请确保服务器正在运行并已安装对应插件。'}
          </p>
          <Link
            href="/"
            className="inline-flex items-center text-xs font-semibold px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 hover:bg-slate-800 transition"
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={pageRef}
      className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden pb-24"
    >
      {/* Background Decorative glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[35rem] w-[50rem] rounded-full bg-violet-900/10 blur-[150px] pointer-events-none" />

      <div className="max-w-5xl mx-auto px-6 pt-12 relative z-10">
        {/* Back Button */}
        <Link
          href="/"
          onClick={handleBack}
          className="inline-flex items-center space-x-2 text-slate-400 hover:text-slate-200 transition mb-10 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">返回发现</span>
        </Link>

        {/* Media Block */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-16">
          {/* Left Column: Cover */}
          <div className="animate-scale-in flex justify-center md:justify-start">
            <div className="w-64 h-88 rounded-2xl overflow-hidden border border-slate-800/80 bg-slate-900 relative shadow-2xl group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={detail.cover}
                alt={detail.title}
                className="w-full h-full object-cover group-hover:scale-105 transition duration-750"
              />
              <div className="absolute top-4 left-4 px-3 py-1 rounded-full text-[10px] font-bold bg-slate-900/90 border border-violet-500/30 text-violet-400 backdrop-blur-md">
                {detail.status || '连载中'}
              </div>
            </div>
          </div>

          {/* Right Column: Meta */}
          <div className="md:col-span-2 flex flex-col justify-between">
            <div>
              <h1 className="animate-fade-in text-3xl sm:text-4xl font-extrabold tracking-tight mb-4 bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                {detail.title}
              </h1>

              {/* Badges */}
              <div className="animate-fade-in flex flex-wrap gap-2 mb-6">
                {detail.genres?.map((genre) => (
                  <span
                    key={genre}
                    className="text-xs px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400"
                  >
                    {genre}
                  </span>
                ))}
              </div>

              {/* Meta Grid */}
              <div className="animate-fade-in grid grid-cols-2 gap-4 border-y border-slate-900 py-4 mb-6 text-sm text-slate-400">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-violet-400" />
                  <span>
                    作者: <strong className="text-slate-200">{detail.author || '未知'}</strong>
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-cyan-400" />
                  <span>
                    更新: <strong className="text-slate-200">{detail.lastUpdate || '最近'}</strong>
                  </span>
                </div>
              </div>

              {/* Description Box */}
              <div className="animate-fade-in bg-slate-900/40 border border-slate-900 rounded-2xl p-5 backdrop-blur-sm">
                <h3 className="text-sm font-semibold text-slate-300 mb-2">作品简介</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  {detail.description || '暂无作品简介。该内容由沙箱解析插件动态从数据源抓取。'}
                </p>
              </div>
            </div>

            {/* Plugin badge info */}
            <div className="animate-fade-in flex items-center space-x-2 text-xs text-slate-500 mt-6 md:mt-0">
              <Compass className="h-4 w-4 text-violet-500" />
              <span>
                数据源插件: <strong className="text-slate-300">{pluginId}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Chapters Section */}
        <section className="bg-slate-900/20 border border-slate-900/60 rounded-2xl p-6 backdrop-blur-sm">
          <div className="flex items-center space-x-2 border-b border-slate-900 pb-4 mb-6">
            <Play className="h-5 w-5 text-violet-400" />
            <h2 className="text-lg font-bold text-slate-200">
              选集 / 章节播放 ({chapters.length})
            </h2>
          </div>

          {chapters.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {chapters.map((ch, idx) => (
                <button
                  key={ch.id}
                  onClick={() => handleChapterClick(ch.id)}
                  onMouseEnter={() => handleChapterMouseEnter(ch.id)}
                  onMouseLeave={() => handleChapterMouseLeave(ch.id)}
                  className="animate-chapter-btn group relative overflow-hidden text-left bg-slate-900 hover:bg-violet-950/20 border border-slate-800/80 hover:border-violet-500/40 rounded-xl p-4 cursor-pointer transition-all duration-300 active:scale-95"
                >
                  <div className="flex justify-between items-start">
                    <span className="text-sm font-semibold text-slate-300 group-hover:text-violet-400 transition-colors line-clamp-1 pr-2">
                      {ch.title}
                    </span>
                    <Play className="h-3 w-3 text-slate-500 opacity-0 group-hover:opacity-100 group-hover:text-violet-400 transform translate-x-1 group-hover:translate-x-0 transition-all duration-300 flex-shrink-0 mt-0.5" />
                  </div>
                  <span className="inline-block mt-2 text-[11px] font-bold px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/20">
                    第 {ch.chapterNo ?? idx + 1} 话
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500 text-sm">
              该插件源未解析出任何章节内容。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
