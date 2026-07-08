'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Heart, History, Loader2, PlayCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore, TrackingLog } from '@/stores/syncStore';
import { API_BASE } from '@/lib/config';

interface DetailInfo {
  title: string;
  cover: string;
}

const STATUS_LABELS: Record<TrackingLog['status'], string> = {
  watching: '在追',
  completed: '已看完',
  plan_to: '想看',
  dropped: '弃坑',
};

const TYPE_LABELS: Record<TrackingLog['mediaType'], string> = {
  anime: '动漫',
  movie: '影视',
  manga: '漫画',
  novel: '小说',
};

function resumeHref(log: TrackingLog): string {
  const base = `/${log.mediaType}/${log.pluginId}/${log.mediaId}`;
  if (!log.chapterId) return base;
  const action = log.mediaType === 'anime' || log.mediaType === 'movie' ? 'play' : 'read';
  return `${base}/${action}/${log.chapterId}`;
}

export default function TrackingPage() {
  const user = useAuthStore((s) => s.user);
  const { trackingList, favoritesList, pullTracking, pullFavorites } = useSyncStore();
  const [details, setDetails] = useState<Record<string, DetailInfo>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    Promise.all([pullTracking(), pullFavorites()]).finally(() => setLoading(false));
  }, [user, pullTracking, pullFavorites]);

  useEffect(() => {
    const pairs = new Map<string, { pluginId: string; mediaId: string }>();
    for (const entry of [...trackingList, ...favoritesList]) {
      pairs.set(`${entry.pluginId}|${entry.mediaId}`, entry);
    }

    pairs.forEach(({ pluginId, mediaId }, key) => {
      if (details[key]) return;
      fetch(`${API_BASE}/api/plugins/${pluginId}/detail/${mediaId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.detail) {
            setDetails((prev) => ({
              ...prev,
              [key]: { title: data.detail.title, cover: data.detail.cover },
            }));
          }
        })
        .catch(() => {});
    });
  }, [trackingList, favoritesList]);

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-textPrimary">
        <div className="max-w-md p-8 rounded-2xl border border-border bg-surface text-center">
          <History className="h-10 w-10 text-primary mx-auto mb-4" />
          <h2 className="text-lg font-bold mb-2">登录后查看追踪记录</h2>
          <p className="text-sm text-textSecondary mb-6">
            追番、追漫和阅读进度会跨端同步到你的账号。
          </p>
          <Link
            href="/"
            className="inline-flex items-center text-xs font-semibold px-4 py-2 rounded-xl bg-surfaceLight border border-border hover:bg-surface transition"
          >
            返回首页登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-textPrimary pb-24">
      <div className="max-w-5xl mx-auto px-6 pt-12">
        <Link
          href="/"
          className="inline-flex items-center space-x-2 text-textSecondary hover:text-textPrimary transition mb-10 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">返回发现</span>
        </Link>

        <h1 className="text-2xl font-extrabold tracking-tight mb-8 flex items-center">
          <History className="h-6 w-6 text-primary mr-3" />
          我的追踪
        </h1>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-textSecondary">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            <span className="text-sm">正在同步云端进度...</span>
          </div>
        ) : trackingList.length === 0 ? (
          <div className="text-center py-16 text-textSecondary text-sm border border-border rounded-2xl bg-surface/40">
            还没有追踪记录，去首页发现内容并开始观看吧。
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-16">
            {trackingList.map((log) => {
              const info = details[`${log.pluginId}|${log.mediaId}`];
              return (
                <Link
                  key={`${log.pluginId}-${log.mediaId}`}
                  href={resumeHref(log)}
                  className="group flex items-center gap-4 p-4 rounded-2xl bg-surface border border-border hover:border-primary/40 hover:bg-surfaceLight transition"
                >
                  <div className="h-20 w-14 rounded-lg overflow-hidden bg-surfaceLight flex-shrink-0">
                    {info?.cover && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={info.cover} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate group-hover:text-primary transition-colors">
                      {info?.title || log.mediaId}
                    </p>
                    <p className="text-xs text-textSecondary mt-1">
                      {TYPE_LABELS[log.mediaType]} · {STATUS_LABELS[log.status]} · 第{' '}
                      {log.chapterNo} 话
                    </p>
                    <div className="mt-2 h-1.5 rounded-full bg-surfaceLight overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.round(log.progress * 100)}%` }}
                      />
                    </div>
                  </div>
                  <PlayCircle className="h-5 w-5 text-textSecondary opacity-0 group-hover:opacity-100 group-hover:text-primary transition flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        )}

        <h2 className="text-lg font-bold tracking-tight mb-6 flex items-center">
          <Heart className="h-5 w-5 text-rose-400 mr-2" />
          我的收藏 ({favoritesList.length})
        </h2>
        {favoritesList.length === 0 ? (
          <div className="text-center py-10 text-textSecondary text-sm border border-border rounded-2xl bg-surface/40">
            暂无收藏内容。
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {favoritesList.map((fav) => {
              const info = details[`${fav.pluginId}|${fav.mediaId}`];
              return (
                <Link
                  key={`${fav.pluginId}-${fav.mediaId}`}
                  href={`/${fav.mediaType}/${fav.pluginId}/${fav.mediaId}`}
                  className="group"
                >
                  <div className="aspect-[2/3] rounded-xl overflow-hidden bg-surface border border-border group-hover:border-primary/40 transition">
                    {info?.cover && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={info.cover}
                        alt=""
                        className="h-full w-full object-cover group-hover:scale-105 transition duration-500"
                      />
                    )}
                  </div>
                  <p className="text-xs font-medium truncate mt-2 text-textSecondary group-hover:text-textPrimary transition-colors">
                    {info?.title || fav.mediaId}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
