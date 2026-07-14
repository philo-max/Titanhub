'use client';

import React, { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  animateDetailPageEntrance,
  animateDetailPageExitBack,
  animateDetailPageExitPlay,
} from '@/lib/animations';
import { ArrowLeft, BookOpen, Calendar, User, Compass, HelpCircle, Loader2 } from 'lucide-react';
import { API_BASE, recordMediaView } from '@/lib/config';

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

export default function NovelDetailPage({ params }: { params: Promise<Params> }) {
  const { pluginId, mediaId } = use(params);
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  const viewRecordedRef = useRef<string | null>(null);
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
            mediaType: 'novel',
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
    if (!loading && detail) {
      const ctx = animateDetailPageEntrance(pageRef.current);
      return () => {
        if (ctx) ctx.revert();
      };
    }
  }, [loading, detail]);

  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault();
    animateDetailPageExitBack(pageRef.current, () => {
      router.back();
    });
  };

  const handleChapterClick = (e: React.MouseEvent, chapterId: string) => {
    e.preventDefault();
    animateDetailPageExitPlay(pageRef.current, () => {
      router.push(`/novel/${pluginId}/${mediaId}/read/${chapterId}`);
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400">
        <Loader2 className="h-10 w-10 text-violet-500 animate-spin mb-4" />
        <p className="text-sm tracking-wider">正在加载沙箱节点小说数据...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <HelpCircle className="h-16 w-16 text-rose-500 mb-4 animate-bounce" />
        <h2 className="text-2xl font-bold text-slate-200 mb-2">获取作品失败</h2>
        <p className="text-slate-400 max-w-md mb-6">{error || '找不到匹配的沙箱轻小说项。'}</p>
        <button
          onClick={() => router.back()}
          className="flex items-center bg-slate-900 border border-slate-800 text-slate-300 px-6 py-2.5 rounded-xl hover:border-slate-700 active:scale-95 transition-all text-sm font-medium"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回搜索页
        </button>
      </div>
    );
  }

  return (
    <div
      ref={pageRef}
      className="relative min-h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans"
    >
      {/* Background Poster Blur Backdrop */}
      <div
        className="absolute top-0 left-0 right-0 h-[450px] bg-cover bg-center opacity-15 blur-2xl pointer-events-none"
        style={{ backgroundImage: `url(${detail.cover})` }}
      />
      <div className="absolute top-0 left-0 right-0 h-[450px] bg-gradient-to-b from-transparent to-slate-950 pointer-events-none" />

      {/* Main Container */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 py-12">
        {/* Back navigation */}
        <button
          onClick={handleBack}
          className="flex items-center text-slate-400 hover:text-white transition-colors mb-8 group"
        >
          <ArrowLeft className="h-5 w-5 mr-2 group-hover:-translate-x-1 transition-transform" />
          返回
        </button>

        {/* Media Info block */}
        <div className="flex flex-col md:flex-row gap-8 items-start mb-12">
          {/* Cover poster image */}
          <div className="animate-scale-in w-48 h-64 rounded-2xl overflow-hidden relative border border-slate-800 shadow-2xl shadow-black/80 flex-shrink-0 mx-auto md:mx-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={detail.cover} alt={detail.title} className="w-full h-full object-cover" />
          </div>

          {/* Details Metadata */}
          <div className="flex-grow flex flex-col justify-between">
            <div>
              <h1 className="animate-fade-in text-3xl font-extrabold text-white tracking-tight mb-4 text-center md:text-left leading-tight">
                {detail.title}
              </h1>

              {/* Tags grid */}
              <div className="animate-fade-in flex flex-wrap gap-2 justify-center md:justify-start mb-6">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-violet-500/10 border border-violet-500/20 text-violet-400">
                  轻小说 (Novel)
                </span>
                {detail.genres?.map((genre, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1 rounded-full text-xs bg-slate-900 border border-slate-800/80 text-slate-300"
                  >
                    {genre}
                  </span>
                ))}
              </div>

              {/* Description */}
              <p className="animate-fade-in text-sm text-slate-400 leading-relaxed text-justify mb-6">
                {detail.description || '暂无简介描述。'}
              </p>
            </div>

            {/* Author / Last update details card */}
            <div className="animate-fade-in grid grid-cols-2 gap-4 border-t border-slate-900 pt-6">
              <div className="flex items-center space-x-3 text-slate-400">
                <div className="h-9 w-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                  <User className="h-4.5 w-4.5 text-violet-400" />
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                    作者
                  </div>
                  <div className="text-xs font-semibold text-slate-300">
                    {detail.author || '未知'}
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-3 text-slate-400">
                <div className="h-9 w-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                  <Calendar className="h-4.5 w-4.5 text-cyan-400" />
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                    更新时间
                  </div>
                  <div className="text-xs font-semibold text-slate-300">
                    {detail.lastUpdate || '最近更新'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Chapters selection section */}
        <section className="bg-slate-900/20 border border-slate-900 backdrop-blur-md rounded-3xl p-6 md:p-8">
          <div className="flex items-center space-x-3 border-b border-slate-900 pb-4 mb-6">
            <BookOpen className="h-6 w-6 text-violet-500" />
            <h3 className="text-lg font-bold text-white">目录列表</h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-bold border border-slate-700/50">
              共 {chapters.length} 章
            </span>
          </div>

          {chapters.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">暂无可用章节目录。</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {chapters.map((chapter, idx) => (
                <a
                  key={chapter.id}
                  href={`/novel/${pluginId}/${mediaId}/read/${chapter.id}`}
                  onClick={(e) => handleChapterClick(e, chapter.id)}
                  className="animate-chapter-btn flex items-center justify-between bg-slate-950/60 border border-slate-900 hover:border-slate-800/80 rounded-xl px-4 py-3.5 hover:bg-slate-900/30 active:scale-97 transition-all text-left text-sm group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex-shrink-0 text-[11px] font-bold px-2 py-1 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/20">
                      {chapter.chapterNo ?? idx + 1}
                    </span>
                    <span className="font-medium text-slate-300 group-hover:text-white transition-colors truncate">
                      {chapter.title}
                    </span>
                  </div>
                  <BookOpen className="h-4 w-4 text-slate-600 group-hover:text-violet-400 transition-colors flex-shrink-0" />
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
