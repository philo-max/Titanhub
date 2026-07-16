'use client';

import React, { useRef } from 'react';
import gsap from 'gsap';
import { MediaItem } from '@titanhub/plugin-types';

export default function MediaCard({
  item,
  originBadge,
  isInfoSource,
}: {
  item: MediaItem;
  originBadge?: string;
  isInfoSource?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const quickToRef = useRef<{
    rotateY?: ReturnType<typeof gsap.quickTo>;
    rotateX?: ReturnType<typeof gsap.quickTo>;
    imageX?: ReturnType<typeof gsap.quickTo>;
    imageY?: ReturnType<typeof gsap.quickTo>;
  }>({});

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    const image = imageRef.current;
    if (!card || !image) return;

    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const xPct = (x / rect.width - 0.5) * 2;
    const yPct = (y / rect.height - 0.5) * 2;

    if (!quickToRef.current.rotateY) {
      quickToRef.current.rotateY = gsap.quickTo(card, 'rotateY', {
        duration: 0.3,
        ease: 'power2.out',
        transformPerspective: 1000,
      });
      quickToRef.current.rotateX = gsap.quickTo(card, 'rotateX', {
        duration: 0.3,
        ease: 'power2.out',
        transformPerspective: 1000,
      });
      quickToRef.current.imageX = gsap.quickTo(image, 'x', { duration: 0.3, ease: 'power2.out' });
      quickToRef.current.imageY = gsap.quickTo(image, 'y', { duration: 0.3, ease: 'power2.out' });
      gsap.set(card, { force3D: true });
    }

    quickToRef.current.rotateY?.(xPct * 10);
    quickToRef.current.rotateX?.(-yPct * 10);
    quickToRef.current.imageX?.(-xPct * 5);
    quickToRef.current.imageY?.(-yPct * 5);
  };

  const handleMouseLeave = () => {
    const card = cardRef.current;
    const image = imageRef.current;
    if (!card || !image) return;

    if (quickToRef.current.rotateY) {
      quickToRef.current.rotateY(0);
      quickToRef.current.rotateX?.(0);
      quickToRef.current.imageX?.(0);
      quickToRef.current.imageY?.(0);
    }
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="group relative flex flex-col gap-2.5 rounded-lg p-2.5 bg-surface border border-borderSubtle hover:bg-surfaceLight hover:border-border hover:shadow-cardHover cursor-pointer will-change-transform transition-colors duration-normal ease-out"
      style={{ transformStyle: 'preserve-3d' }}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-md bg-surfaceLight">
        {item.cover ? (
          <img
            ref={imageRef}
            src={item.cover}
            alt={item.title}
            className="absolute inset-0 w-full h-full object-cover scale-[1.05]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-primary/15 via-surfaceLight to-secondary/15 flex flex-col items-center justify-center gap-2">
            <span className="text-3xl font-bold text-textTertiary/30 select-none">
              {item.title?.charAt(0) || '?'}
            </span>
            {originBadge && (
              <span className="text-[10px] font-medium text-textTertiary/40 px-2 py-0.5 rounded-full bg-surface/60 border border-borderSubtle">
                {originBadge}
              </span>
            )}
          </div>
        )}
        {/* Gradient overlay on hover — Spotify-style content emergence */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-normal ease-out" />
        {item.updateInfo && (
          <div className="absolute top-1.5 right-1.5 pill-badge bg-black/70 backdrop-blur-md text-white border border-white/10">
            {item.updateInfo}
          </div>
        )}
        {originBadge && (
          <div className="absolute bottom-1.5 left-1.5 pill-badge bg-black/60 backdrop-blur-md text-textSecondary border border-white/5">
            {originBadge}
          </div>
        )}
        {isInfoSource && (
          <div className="absolute top-1.5 left-1.5 pill-badge bg-amber-500/80 backdrop-blur-md text-white border border-amber-300/20">
            资讯
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        <h3 className="text-sm font-medium text-textPrimary truncate group-hover:text-primary transition-colors duration-fast ease-out">
          {item.title}
        </h3>
        <p className="text-xs text-textTertiary line-clamp-2 leading-relaxed">{item.description}</p>
      </div>
    </div>
  );
}
