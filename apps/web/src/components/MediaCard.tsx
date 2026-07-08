'use client';

import React, { useRef } from 'react';
import gsap from 'gsap';
import { MediaItem } from '@titanhub/plugin-types';

export default function MediaCard({
  item,
  originBadge,
}: {
  item: MediaItem;
  originBadge?: string;
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
      className="group relative flex flex-col gap-3 rounded-2xl p-3 bg-surface border border-border shadow-lg transition-colors hover:border-primary/30 hover:bg-surfaceLight cursor-pointer will-change-transform"
      style={{ transformStyle: 'preserve-3d' }}
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl bg-surfaceLight">
        <img
          ref={imageRef}
          src={item.cover}
          alt={item.title}
          className="absolute inset-0 w-full h-full object-cover scale-[1.05]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        {item.updateInfo && (
          <div className="absolute top-2 right-2 px-2 py-1 bg-background/80 backdrop-blur-md rounded-md text-xs font-bold text-secondary border border-border">
            {item.updateInfo}
          </div>
        )}
        {originBadge && (
          <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-background/70 backdrop-blur-md rounded-md text-[10px] font-medium text-textSecondary border border-border">
            {originBadge}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-textPrimary font-bold truncate group-hover:text-primary transition-colors">
          {item.title}
        </h3>
        <p className="text-sm text-textSecondary line-clamp-2">{item.description}</p>
      </div>
    </div>
  );
}
