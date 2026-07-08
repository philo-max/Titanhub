'use client';

import React, { use, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  animatePlayPageEntrance,
  animatePlayPageExitNext,
  animatePlayPageExitBack,
} from '@/lib/animations';
import { ArrowLeft, Play, RefreshCw, Loader2, Compass } from 'lucide-react';
import dynamic from 'next/dynamic';
import { DanmakuComment } from '@/components/DanmakuLayer';
import { useSyncStore } from '@/stores/syncStore';
import { useAuthStore } from '@/stores/authStore';
import { API_BASE } from '@/lib/config';

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
  const { pluginId, mediaId, chapterId } = use(params);
  const router = useRouter();
  const pageRef = useRef<HTMLDivElement>(null);

  const [sources, setSources] = useState<VideoSource[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [comments, setComments] = useState<DanmakuComment[]>([]);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { saveProgress } = useSyncStore();
  const lastSyncTimeRef = useRef<number>(0);

  useEffect(() => {
    const fetchPlaybackData = async () => {
      setLoading(true);
      setError('');
      try {
        // 1. Fetch video URL from sandbox
        const videoRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/video/${chapterId}`);
        const videoData = await videoRes.json();

        if (videoData.error) {
          throw new Error(`获取视频链接失败: ${videoData.error}`);
        }

        const sourceList: VideoSource[] = videoData.videos || [];
        if (sourceList.length === 0) {
          throw new Error('未解析出可用的视频播放源。');
        }
        // Select the highest quality or first source
        setSources(sourceList);

        // 2. Fetch all chapters for navigation and episode list
        const chaptersRes = await fetch(`${API_BASE}/api/plugins/${pluginId}/chapters/${mediaId}`);
        const chaptersData = await chaptersRes.json();

        if (chaptersData.error) {
          throw new Error(`获取选集列表失败: ${chaptersData.error}`);
        }

        const list: Chapter[] = chaptersData.chapters || [];
        setChapters(list);

        const activeCh = list.find((c) => c.id === chapterId) || null;
        setCurrentChapter(activeCh);

        // 3. Fetch mock danmaku list
        const danmakuRes = await fetch(
          `${API_BASE}/api/danmaku/${pluginId}/${mediaId}/${chapterId}`
        );
        const danmakuData = await danmakuRes.json();
        setComments(danmakuData.comments || []);
      } catch (err: any) {
        setError(err.message || '加载播放资源失败。');
      } finally {
        setLoading(false);
      }
    };

    fetchPlaybackData();
  }, [pluginId, mediaId, chapterId]);

  // GSAP Entrance Animations
  useEffect(() => {
    if (!loading && sources.length > 0) {
      const ctx = animatePlayPageEntrance(pageRef.current);
      return () => {
        if (ctx) ctx.revert();
      };
    }
  }, [loading, sources]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-textPrimary">
        <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
        <p className="text-sm text-textSecondary">正在与沙箱引擎安全交换视频流与弹幕通道...</p>
      </div>
    );
  }

  if (error || sources.length === 0) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-textPrimary">
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
          <VideoPlayer
            sources={sources}
            title={currentChapter?.title || 'Current Chapter'}
            comments={comments}
            onSendComment={handleSendComment}
            onNextChapter={nextChapter ? handleNextChapterClick : undefined}
            onProgress={(time, duration) => {
              // Sync every 5 seconds
              if (time - lastSyncTimeRef.current > 5 || time < lastSyncTimeRef.current) {
                lastSyncTimeRef.current = time;
                saveProgress({
                  mediaId,
                  pluginId,
                  mediaType: 'anime',
                  chapterNo: currentChapter?.chapterNo ?? 1,
                  chapterId,
                  progress: duration > 0 ? time / duration : 0,
                  status: 'watching',
                });
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
