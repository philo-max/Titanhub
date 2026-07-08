'use client';

import React, { useEffect, useRef } from 'react';
import { animateParallaxScroll } from '../lib/animations';

export default function HeroBanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLImageElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = animateParallaxScroll(containerRef.current, bgRef.current, textRef.current);

    return () => {
      if (ctx) ctx.revert();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-[65vh] min-h-[500px] w-full overflow-hidden rounded-b-[2.5rem] sm:rounded-b-[4rem] shadow-2xl bg-background"
    >
      {/* Background Image */}
      <img
        ref={bgRef}
        src="/images/hero.png"
        alt="Hero Background"
        className="absolute inset-0 w-full h-full object-cover origin-top"
      />
      {/* Gradient Overlay for dark premium aesthetic */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent opacity-95" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end p-8 sm:p-16 lg:p-24 max-w-[1400px] mx-auto w-full z-10">
        <div ref={textRef} className="space-y-6 max-w-3xl">
          <h1 className="text-5xl sm:text-7xl font-extrabold text-white tracking-tight leading-tight drop-shadow-xl">
            One App, <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-accent to-secondary">
              All ACG Content.
            </span>
          </h1>
          <p className="text-lg sm:text-2xl text-textSecondary font-medium drop-shadow-md max-w-2xl leading-relaxed">
            Experience the ultimate aggregator for Anime, Manga, Light Novels, and Movies with
            unparalleled performance and design.
          </p>
          <div className="pt-6 flex flex-wrap gap-4">
            <button className="px-8 py-4 bg-white text-black font-bold rounded-full hover:bg-gray-200 transition-transform hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(255,255,255,0.3)]">
              Start Exploring
            </button>
            <button className="px-8 py-4 bg-white/5 backdrop-blur-xl text-white font-bold rounded-full border border-white/10 hover:bg-white/10 transition-colors">
              Read Docs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
