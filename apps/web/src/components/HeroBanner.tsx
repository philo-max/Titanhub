'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import SmartImage from './SmartImage';
import { animateParallaxScroll } from '../lib/animations';
import { API_BASE } from '../lib/config';
import { AggregatedMediaItem } from '@titanhub/plugin-types';

const TYPE_LABELS: Record<string, string> = {
  anime: '动漫',
  manga: '漫画',
  novel: '小说',
  movie: '影视',
};

export default function HeroBanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const [featured, setFeatured] = useState<AggregatedMediaItem | null>(null);

  useEffect(() => {
    const fetchFeatured = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/aggregate/home?type=anime&page=1&pageSize=10`);
        if (!res.ok) return;
        const data = await res.json();
        const items: AggregatedMediaItem[] = Array.isArray(data.items) ? data.items : [];
        const withCover = items.find((it) => it.cover);
        if (withCover) setFeatured(withCover);
      } catch {
      }
    };
    fetchFeatured();
  }, []);

  useEffect(() => {
    const ctx = animateParallaxScroll(containerRef.current, bgRef.current, textRef.current);
    return () => {
      if (ctx) ctx.revert();
    };
  }, []);

  const detailHref = featured
    ? `/${featured.mediaType}/${featured.pluginId}/${featured.id}`
    : null;

  return (
    <div
      ref={containerRef}
      className="relative h-[65vh] min-h-[500px] w-full overflow-hidden rounded-b-3xl sm:rounded-b-[4rem] shadow-dialog bg-background"
    >
      {/* Background */}
      <div ref={bgRef} className="absolute inset-0 origin-top">
        {featured?.cover ? (
          <SmartImage
            src={featured.cover}
            alt={featured.title}
            fill
            priority
            sizes="100vw"
            className="object-cover scale-110 blur-sm"
          />
        ) : (
          <SmartImage
            src="/images/hero.png"
            alt="Hero Background"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        )}
      </div>

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent opacity-95" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/30 to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-8 sm:p-16 lg:p-24 max-w-[1400px] mx-auto w-full z-10">
        <div ref={textRef} className="space-y-5 max-w-3xl">
          {featured ? (
            <>
              {featured.mediaType && (
                <span className="pill-badge inline-block bg-primary/15 border border-primary/25 text-primary">
                  {TYPE_LABELS[featured.mediaType] || featured.mediaType} · {featured.pluginName}
                </span>
              )}
              <h1 className="text-4xl sm:text-6xl font-bold text-white tracking-tight leading-tight drop-shadow-xl line-clamp-2" style={{ letterSpacing: '-0.025em' }}>
                {featured.title}
              </h1>
              {featured.description && (
                <p className="text-base sm:text-lg text-textSecondary drop-shadow-md max-w-2xl leading-relaxed line-clamp-3">
                  {featured.description}
                </p>
              )}
              <div className="pt-4 flex flex-wrap gap-4">
                {detailHref && (
                  <Link
                    href={detailHref}
                    className="px-8 py-3.5 bg-white text-black font-semibold rounded-pill hover:bg-white/90 transition-all duration-normal ease-out hover:scale-105 active:scale-95 shadow-card"
                  >
                    立即观看
                  </Link>
                )}
                <Link
                  href="/search"
                  className="px-8 py-3.5 glass-surface text-white font-semibold rounded-pill border border-white/10 hover:bg-white/10 transition-colors duration-normal ease-out"
                >
                  探索更多
                </Link>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-5xl sm:text-7xl font-bold text-white leading-tight drop-shadow-xl" style={{ letterSpacing: '-0.035em' }}>
                One App, <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-secondary">
                  All ACG Content.
                </span>
              </h1>
              <p className="text-lg sm:text-2xl text-textSecondary drop-shadow-md max-w-2xl leading-relaxed">
                Experience the ultimate aggregator for Anime, Manga, Light Novels, and Movies.
              </p>
              <div className="pt-6 flex flex-wrap gap-4">
                <Link
                  href="/search"
                  className="px-8 py-3.5 bg-white text-black font-semibold rounded-pill hover:bg-white/90 transition-all duration-normal ease-out hover:scale-105 active:scale-95 shadow-card"
                >
                  Start Exploring
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
