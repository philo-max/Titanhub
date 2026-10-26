'use client';

import React, { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  animatePlayPageEntrance,
  animatePlayPageExitNext,
  animatePlayPageExitBack,
} from '@/lib/animations';
import { ArrowLeft, Play, Loader2, Compass } from 'lucide-react';
import dynamic from 'next/dynamic';
import { DanmakuComment } from '@/components/DanmakuLayer';
import { useSyncStore, type TrackingLog } from '@/stores/syncStore';
import { findResumeLog } from '@/lib/resume-position';
import { useAuthStore } from '@/stores/authStore';
import { API_BASE } from '@/lib/config';
import { playbackCache } from '@/lib/playbackCache';
import { findPlayableAlternative } from '@/lib/source-fallback';

const VideoPlayer = dynamic(() => import('@/components/VideoPlayer'), {
  ssr: false,
  loading: () => (
    <div className="w-full aspect-video rounded-2xl overflow-hidden bg-surface/60 border border-surface flex flex-col items-center justify-center text-textSecondary">
      <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
      <span className="text-xs">加载播放器内核...</span>
    </div>
  ),
});

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

interface VideoSource {
  quality: string;
  url: string;
}

export default function AnimePlayPage({ params }: { params: Promise<Params> }) {
  const identity = use(params);
  return <AnimePlayPageContent key={JSON.stringify(identity)} params={params} />;
}

function AnimePlayPageContent({ params }: { params: Promise<Params> }) {
  const { pluginId, mediaId, chapterId } = use(params);
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);

  const [sources, setSources] = useState<VideoSource[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [comments, setComments] = useState<DanmakuComment[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fallbackNote, setFallbackNote] = useState('');

  const { saveProgress } = useSyncStore();
  const lastSyncTimeRef = useRef<number>(0);
  const [resume, setResume] = useState<TrackingLog>();
  const [resumeReady, setResumeReady] = useState(false);
  const [progressError, setProgressError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void useSyncStore.getState().pullTracking().then(() => {
      if (cancelled) return;
      const saved = findResumeLog(useSyncStore.getState().trackingList, {
        mediaType: 'anime', pluginId, mediaId, chapterId,
      });
      setResume(saved);
      setResumeReady(true);
    }).catch(() => {
      if (!cancelled) {
        setError('读取播放进度失败，请重新打开本章。');
        setResumeReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [pluginId, mediaId, chapterId]);

  useEffect(() => {
    const controller = new AbortController();
    const tryAlternativeSource = async (): Promise<boolean> => {
      const detailData = await fetch(`${API_BASE}/api/plugins/${pluginId}/detail/${mediaId}`, { signal: controller.signal })
        .then((r) => r.json())
        .catch(() => null);
      const title: string | undefined = detailData?.detail?.title;
      if (!title) return false;
      const tried = new URLSearchParams(window.location.search).get('tried')?.split(',').filter(Boolean) ?? [];
      const found = await findPlayableAlternative({
        title, pluginId, mediaId, chapterId, tried, signal: controller.signal,
        onAttempt: (source, attempt, total) => setFallbackNote(`正在尝试其他来源：${source.pluginName}（${attempt}/${total}）`),
      });
      if (!found || controller.signal.aborted) return false;
      playbackCache.set(found.pluginId, found.chapterId, { sources: found.videos });
      router.replace(`/anime/${found.pluginId}/${found.mediaId}/play/${found.chapterId}?tried=${[...tried, pluginId].join(',')}`);
      return true;
    };

    const fetchPlaybackData = async () => {
      let handedOff = false;
      // 1. Try to read from prefetch cache
      const cached = playbackCache.get(pluginId, chapterId);
      
      if (cached && cached.sources) {
        setSources(cached.sources);
        setComments(cached.comments || []);
        setLoading(false);
        setError('');
        
        // Fetch chapters list in the background
        try {
          const chaptersRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/chapters/${mediaId}`);
          const chaptersData = await chaptersRes.json();
          const list: Chapter[] = chaptersData.chapters || [];
          setChapters(list);
          setCurrentChapter(list.find((c) => c.id === chapterId) || null);
        } catch (err) {
          console.warn('[AnimePlayPage] Background chapters fetch failed:', err);
        }
        return;
      }

      setLoading(true);
      setError('');
      try {
        // Chapters and danmaku load in the background so a slow chapter list or
        // danmaku source never delays playback; chapters must survive a video
        // failure so the error state can offer other episodes
        void fetch(`${API_BASE}/api/plugins/${pluginId}/chapters/${mediaId}`)
          .then((r) => r.json())
          .catch(() => ({ chapters: [] }))
          .then((chaptersData) => {
            const list: Chapter[] = chaptersData.chapters || [];
            setChapters(list);
            setCurrentChapter(list.find((c) => c.id === chapterId) || null);
          });
        void fetch(`${API_BASE}/api/danmaku/${pluginId}/${mediaId}/${chapterId}`)
          .then((r) => r.json())
          .catch(() => ({ comments: [] }))
          .then((danmakuData) => setComments(danmakuData.comments || []));

        const videoData = await fetch(`${API_BASE}/api/plugins/${pluginId}/video/${chapterId}`)
          .then((r) => r.json())
          .catch(() => ({ error: '无法连接后端服务。' }));

        if (videoData.error) {
          throw new Error(`获取视频链接失败: ${videoData.error}`);
        }

        const sourceList: VideoSource[] = videoData.videos || [];
        if (sourceList.length === 0) {
          throw new Error('未解析出可用的视频播放源，该线路可能已失效。');
        }
        setSources(sourceList);
      } catch (err: any) {
        const message = err.message || '加载播放资源失败。';
        handedOff = await tryAlternativeSource().catch(() => false);
        if (!handedOff && !controller.signal.aborted) setError(message);
      } finally {
        if (!handedOff && !controller.signal.aborted) setLoading(false);
      }
    };

    fetchPlaybackData();
    return () => controller.abort();
  }, [pluginId, mediaId, chapterId, router]);

  // GSAP Entrance Animations
  useEffect(() => {
    if (!loading && resumeReady && sources.length > 0) {
      const ctx = animatePlayPageEntrance(pageRef.current);
      return () => {
        if (ctx) ctx.revert();
      };
    }
  }, [loading, resumeReady, sources]);

  // Determine next episode
  const getNextChapter = () => {
    const currentIndex = chapters.findIndex((c) => c.id === chapterId);
    if (currentIndex >= 0 && currentIndex < chapters.length - 1) {
      return chapters[currentIndex + 1];
    }
    return null;
  };
  const nextChapter = getNextChapter();

  const handleNextChapterClick = () => {
    if (nextChapter) {
      animatePlayPageExitNext(pageRef.current, () => {
        router.push(`/anime/${pluginId}/${mediaId}/play/${nextChapter.id}`);
      });
    }
  };

  const handleSendComment = (text: string, time: number) => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    fetch(`${API_BASE}/api/danmaku`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ pluginId, mediaId, chapterId, time, text, color: '#FFFF33' }),
    }).catch(() => {});
  };

  const handleBack = (e: React.MouseEvent) => {
    e.preventDefault();
    animatePlayPageExitBack(pageRef.current, () => {
      router.push(`/anime/${pluginId}/${mediaId}`);
    });
  };

  if (loading || !resumeReady) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-textPrimary">
        <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
        <p className="text-sm text-textSecondary">正在解析播放源...</p>
        <p className="text-xs text-textTertiary mt-2">{fallbackNote || '首次解析约需 10-15 秒，已缓存的视频秒开'}</p>
      </div>
    );
  }

  if (error || sources.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-textPrimary">
        <div className="max-w-md p-6 rounded-2xl border border-rose-500/20 bg-rose-500/5 text-center">
          <h2 className="text-lg font-bold text-rose-400 mb-2">播放失败</h2>
          <p className="text-sm text-textSecondary mb-6">{error}</p>
          <Link
            href={`/anime/${pluginId}/${mediaId}`}
            className="inline-flex items-center text-xs font-semibold px-4 py-2 rounded-xl bg-surface border border-border text-textPrimary hover:bg-surfaceLight transition"
          >
            返回详情页
          </Link>
        </div>

        {chapters.length > 0 && (
          <div className="w-full max-w-3xl mt-10">
            <p className="text-sm text-textSecondary text-center mb-4">
              该集解析失败，换一条线路或其他选集试试：
            </p>
            <div className="flex flex-wrap gap-3 justify-center max-h-64 overflow-y-auto">
              {chapters.map((ch) => {
                const isActive = ch.id === chapterId;
                return (
                  <Link
                    key={ch.id}
                    href={`/anime/${pluginId}/${mediaId}/play/${ch.id}`}
                    className={`text-xs px-4 py-2.5 rounded-xl border font-semibold transition-all active:scale-95 ${
                      isActive
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                        : 'bg-surface border-border text-textSecondary hover:text-textPrimary hover:border-surfaceLight'
                    }`}
                  >
                    {ch.title}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={pageRef} className="min-h-screen bg-background text-textPrimary pb-24">
      {/* Background radial glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[30rem] w-[60rem] rounded-full bg-primary/5 blur-[150px] pointer-events-none" />

      <div className="max-w-5xl mx-auto px-6 pt-12 relative z-10">
        {/* Navigation back */}
        <Link
          href={`/anime/${pluginId}/${mediaId}`}
          onClick={handleBack}
          className="inline-flex items-center space-x-2 text-textSecondary hover:text-textPrimary transition mb-6 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">返回详情</span>
        </Link>

        {/* Header Title */}
        <div className="animate-fade-play mb-8">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-textPrimary">
            {currentChapter?.title || '正在播放章节'}
          </h1>
          <p className="text-xs text-textSecondary mt-1 flex items-center space-x-2">
            <Compass className="h-3 w-3 text-primary" />
            <span>沙箱插件: {pluginId}</span>
            <span>•</span>
            <span>当前话: {currentChapter?.chapterNo ?? 1}</span>
          </p>
        </div>

        {/* Video Player Section */}
        <div className="animate-fade-play mb-12">
          {progressError && <p role="alert" className="text-rose-500">{progressError}</p>}
          <VideoPlayer
            initialPosition={resume?.position}
            initialProgress={resume?.progress}
            sources={sources}
            title={currentChapter?.title || 'Current Chapter'}
            comments={comments}
            pluginId={pluginId}
            mediaId={mediaId}
            chapterId={chapterId}
            onSendComment={handleSendComment}
            onNextChapter={nextChapter ? handleNextChapterClick : undefined}
            onProgress={(time, duration, force) => {
              // Sync every 5 seconds
              if (force || time - lastSyncTimeRef.current > 5 || time < lastSyncTimeRef.current) {
                lastSyncTimeRef.current = time;
                saveProgress({
                  mediaId,
                  pluginId,
                  mediaType: 'anime',
                  chapterNo: currentChapter?.chapterNo ?? 1,
                  chapterId,
                  progress: duration > 0 ? time / duration : 0,
                  position: time,
                  status: 'watching',
                }).catch(() => setProgressError('保存播放进度失败，请稍后重试。'));
              }
            }}
          />
        </div>

        {/* Quick Episode Selection Panel */}
        <section className="animate-fade-play bg-surface/20 border border-surface/60 rounded-2xl p-6 backdrop-blur-sm">
          <h3 className="text-sm font-bold text-textPrimary mb-4 flex items-center space-x-2">
            <Play className="h-4 w-4 text-primary fill-primary/20" />
            <span>快速选集</span>
          </h3>

          <div className="flex flex-wrap gap-3">
            {chapters.map((ch) => {
              const isActive = ch.id === chapterId;
              return (
                <Link
                  key={ch.id}
                  href={`/anime/${pluginId}/${mediaId}/play/${ch.id}`}
                  className={`text-xs px-4 py-2.5 rounded-xl border font-semibold transition-all duration-300 active:scale-95 ${
                    isActive
                      ? 'bg-primary border-primary text-white shadow-lg shadow-primary/25'
                      : 'bg-surface border-border text-textSecondary hover:text-textPrimary hover:border-surfaceLight'
                  }`}
                >
                  {ch.title}
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
