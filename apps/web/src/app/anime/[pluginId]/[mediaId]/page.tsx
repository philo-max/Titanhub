'use client';

import React, { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import SmartImage from '@/components/SmartImage';
import { useRouter } from 'next/navigation';
import {
  animateDetailPageEntrance,
  animateDetailPageExitBack,
  animateDetailPageExitPlay,
} from '@/lib/animations';
import { ArrowLeft, Play, Calendar, User, Compass, HelpCircle, Loader2, Search, Info, Tv, ChevronRight } from 'lucide-react';
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

export default function AnimeDetailPage({ params }: { params: Promise<Params> }) {
  const { pluginId, mediaId } = use(params);
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);
  const viewRecordedRef = useRef<string | null>(null);
  const prefetchTimersRef = useRef<Record<string, NodeJS.Timeout>>({});
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [providesVideo, setProvidesVideo] = useState(true);
  const [crossSourceResults, setCrossSourceResults] = useState<Record<string, Array<{ id: string; title: string; cover: string; pluginId: string; pluginName: string }>>>({});
  const [crossSourceLoading, setCrossSourceLoading] = useState(false);
  const [crossSourceError, setCrossSourceError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        // Fetch detailed media metadata first
        const detailRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/detail/${mediaId}`);
        const detailData = await detailRes.json();

        if (detailData.error) {
          throw new Error(detailData.error);
        }
        setDetail(detailData.detail);

        // Check if this plugin provides video playback
        const pluginsRes = await fetch(`${API_BASE}/api/plugins`);
        const pluginsData = await pluginsRes.json();
        const currentPlugin = pluginsData.plugins?.find((p: any) => p.id === pluginId);
        if (currentPlugin && currentPlugin.providesVideo === false) {
          setProvidesVideo(false);
          // Auto-search all video sources for this title (Kazumi SourceSheet pattern)
          setCrossSourceLoading(true);
          try {
            const searchRes = await fetch(`${API_BASE}/api/aggregate/search?q=${encodeURIComponent(detailData.detail.title)}&type=anime`);
            const searchData = await searchRes.json();
            const items = (searchData.items || []).filter((item: any) => item.providesVideo !== false);
            // Group by pluginName
            const grouped: Record<string, Array<typeof items[0]>> = {};
            for (const item of items) {
              if (!grouped[item.pluginName]) grouped[item.pluginName] = [];
              grouped[item.pluginName].push(item);
            }
            setCrossSourceResults(grouped);
          } catch (e: any) {
            setCrossSourceError('跨源搜索失败，请手动搜索');
          } finally {
            setCrossSourceLoading(false);
          }
        }
        if (viewRecordedRef.current !== mediaId) {
          viewRecordedRef.current = mediaId;
          recordMediaView({
            mediaType: 'anime',
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
      router.push(`/anime/${pluginId}/${mediaId}/play/${chapterId}`);
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
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-textPrimary">
        <Loader2 className="h-10 w-10 text-violet-400 animate-spin mb-4" />
        <p className="text-sm text-textSecondary">正在与沙箱引擎通信并加载 ACG 详情...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-textPrimary">
        <div className="max-w-md p-6 rounded-2xl border border-rose-500/20 bg-rose-500/5 text-center">
          <HelpCircle className="h-12 w-12 text-rose-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-rose-400 mb-2">获取详情失败</h2>
          <p className="text-sm text-textSecondary mb-6">
            {error || '找不到插件源内容，请确保服务器正在运行并已安装对应插件。'}
          </p>
          <Link
            href="/"
            className="inline-flex items-center text-xs font-semibold px-4 py-2 rounded-xl bg-surface border border-borderSubtle text-textPrimary hover:bg-surfaceLight transition"
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
      className="min-h-screen bg-background text-textPrimary relative overflow-hidden pb-24"
    >
      {/* Background Decorative glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[35rem] w-[50rem] rounded-full bg-violet-900/10 blur-[150px] pointer-events-none" />

      <div className="max-w-5xl mx-auto px-6 pt-12 relative z-10">
        {/* Back Button */}
        <Link
          href="/"
          onClick={handleBack}
          className="inline-flex items-center space-x-2 text-textSecondary hover:text-textPrimary transition mb-10 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">返回发现</span>
        </Link>

        {/* Media Block */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-16">
          {/* Left Column: Cover */}
          <div className="animate-scale-in flex justify-center md:justify-start">
            <div className="w-64 h-88 rounded-2xl overflow-hidden border border-borderSubtle/80 bg-surface relative shadow-2xl group">
              <SmartImage
                src={detail.cover}
                alt={detail.title}
                width={256}
                height={352}
                className="w-full h-full object-cover group-hover:scale-105 transition duration-750"
              />
              <div className="absolute top-4 left-4 px-3 py-1 rounded-full text-[10px] font-bold bg-surface/90 border border-violet-500/30 text-violet-400 backdrop-blur-md">
                {detail.status || '连载中'}
              </div>
            </div>
          </div>

          {/* Right Column: Meta */}
          <div className="md:col-span-2 flex flex-col justify-between">
            <div>
              <h1 className="animate-fade-in text-3xl sm:text-4xl font-extrabold tracking-tight mb-4 bg-gradient-to-r from-white via-textPrimary to-textSecondary bg-clip-text text-transparent">
                {detail.title}
              </h1>

              {/* Badges */}
              <div className="animate-fade-in flex flex-wrap gap-2 mb-6">
                {detail.genres?.map((genre) => (
                  <span
                    key={genre}
                    className="text-xs px-3 py-1 rounded-lg bg-surface border border-borderSubtle text-textSecondary"
                  >
                    {genre}
                  </span>
                ))}
              </div>

              {/* Meta Grid */}
              <div className="animate-fade-in grid grid-cols-2 gap-4 border-y border-borderSubtle py-4 mb-6 text-sm text-textSecondary">
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-violet-400" />
                  <span>
                    作者: <strong className="text-textPrimary">{detail.author || '未知'}</strong>
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-cyan-400" />
                  <span>
                    更新: <strong className="text-textPrimary">{detail.lastUpdate || '最近'}</strong>
                  </span>
                </div>
              </div>

              {/* Description Box */}
              <div className="animate-fade-in bg-surface/40 border border-borderSubtle rounded-2xl p-5 backdrop-blur-sm">
                <h3 className="text-sm font-semibold text-textSecondary mb-2">作品简介</h3>
                <p className="text-sm text-textSecondary leading-relaxed">
                  {detail.description || '暂无作品简介。该内容由沙箱解析插件动态从数据源抓取。'}
                </p>
              </div>
            </div>

            {/* Plugin badge info */}
            <div className="animate-fade-in flex items-center space-x-2 text-xs text-textTertiary mt-6 md:mt-0">
              <Compass className="h-4 w-4 text-violet-500" />
              <span>
                数据源插件: <strong className="text-textSecondary">{pluginId}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Chapters Section */}
        <section className="bg-surface/20 border border-borderSubtle/60 rounded-2xl p-6 backdrop-blur-sm">
          <div className="flex items-center space-x-2 border-b border-borderSubtle pb-4 mb-6">
            <Play className="h-5 w-5 text-violet-400" />
            <h2 className="text-lg font-bold text-textPrimary">
              选集 / 章节播放 ({chapters.length})
            </h2>
          </div>

          {providesVideo ? (
            chapters.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {chapters.map((ch, idx) => (
                  <button
                    key={ch.id}
                    onClick={() => handleChapterClick(ch.id)}
                    onMouseEnter={() => handleChapterMouseEnter(ch.id)}
                    onMouseLeave={() => handleChapterMouseLeave(ch.id)}
                    className="animate-chapter-btn group relative overflow-hidden text-left bg-surface hover:bg-violet-950/20 border border-borderSubtle/80 hover:border-violet-500/40 rounded-xl p-4 cursor-pointer transition-all duration-300 active:scale-95"
                  >
                    <div className="flex justify-between items-start">
                      <span className="text-sm font-semibold text-textSecondary group-hover:text-violet-400 transition-colors line-clamp-1 pr-2">
                        {ch.title}
                      </span>
                      <Play className="h-3 w-3 text-textTertiary opacity-0 group-hover:opacity-100 group-hover:text-violet-400 transform translate-x-1 group-hover:translate-x-0 transition-all duration-300 flex-shrink-0 mt-0.5" />
                    </div>
                    <span className="inline-block mt-2 text-[11px] font-bold px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/20">
                      第 {ch.chapterNo ?? idx + 1} 话
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-textTertiary text-sm">
                该插件源未解析出任何章节内容。
              </div>
            )
          ) : (
            /* Info-only source: Kazumi-style cross-source watch panel */
            <div>
              {chapters.length > 0 && (
                <details className="mb-6 group">
                  <summary className="cursor-pointer text-sm text-textTertiary hover:text-textSecondary transition select-none flex items-center gap-2">
                    <ChevronRight className="h-4 w-4 group-open:rotate-90 transition" />
                    <span>查看章节数据 ({chapters.length} 话)</span>
                  </summary>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mt-4">
                    {chapters.map((ch, idx) => (
                      <div
                        key={ch.id}
                        className="text-left bg-surface/60 border border-borderSubtle/50 rounded-xl p-4 opacity-50"
                      >
                        <span className="text-sm font-medium text-textSecondary line-clamp-1">
                          {ch.title}
                        </span>
                        <span className="inline-block mt-2 text-[11px] font-bold px-2 py-0.5 rounded-md bg-surfaceLight/30 text-textTertiary border border-border/20">
                          第 {ch.chapterNo ?? idx + 1} 话
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Cross-source watch panel */}
              <div className="rounded-xl bg-violet-950/10 border border-violet-500/20 overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-violet-500/15">
                  <Tv className="h-5 w-5 text-violet-400" />
                  <div>
                    <p className="text-sm font-semibold text-textPrimary">在线观看</p>
                    <p className="text-xs text-textTertiary">
                      来自视频源的搜索结果，点击进入播放
                    </p>
                  </div>
                </div>

                <div className="p-4">
                  {crossSourceLoading ? (
                    <div className="flex items-center justify-center py-8 gap-3">
                      <Loader2 className="h-5 w-5 text-violet-400 animate-spin" />
                      <span className="text-sm text-textSecondary">
                        正在搜索「{detail.title}」...
                      </span>
                    </div>
                  ) : crossSourceError ? (
                    <div className="text-center py-6">
                      <p className="text-sm text-textSecondary mb-4">{crossSourceError}</p>
                      <Link
                        href={`/search?q=${encodeURIComponent(detail.title)}&type=anime`}
                        className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition"
                      >
                        <Search className="h-4 w-4" />
                        <span>手动搜索</span>
                      </Link>
                    </div>
                  ) : Object.keys(crossSourceResults).length === 0 ? (
                    <div className="text-center py-6">
                      <p className="text-sm text-textSecondary mb-1">
                        暂无视频源提供「{detail.title}」的播放
                      </p>
                      <p className="text-xs text-textTertiary mb-4">
                        可能番剧标题与源站不匹配，试试手动搜索
                      </p>
                      <Link
                        href={`/search?q=${encodeURIComponent(detail.title)}&type=anime`}
                        className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl bg-surfaceLight hover:bg-surfaceLight text-textPrimary transition"
                      >
                        <Search className="h-4 w-4" />
                        <span>手动搜索</span>
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {Object.entries(crossSourceResults).map(([sourceName, items]) => (
                        <div key={sourceName}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
                            <span className="text-xs font-semibold text-textSecondary">{sourceName}</span>
                            <span className="text-xs text-textTertiary">{items.length} 个结果</span>
                          </div>
                          <div className="flex gap-3 overflow-x-auto pb-2">
                            {items.map((item) => (
                              <Link
                                key={`${item.pluginId}-${item.id}`}
                                href={`/anime/${item.pluginId}/${item.id}`}
                                className="flex-shrink-0 w-28 group cursor-pointer"
                              >
                                <div className="w-28 h-40 rounded-lg overflow-hidden border border-borderSubtle/80 bg-surface group-hover:border-violet-500/40 transition">
                                  <SmartImage
                                    src={item.cover}
                                    alt={item.title}
                                    width={112}
                                    height={160}
                                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                                  />
                                </div>
                                <p className="text-xs text-textSecondary group-hover:text-violet-400 mt-1.5 line-clamp-2 transition leading-tight">
                                  {item.title}
                                </p>
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
