'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { animateDanmakuTravel, DanmakuTween } from '../lib/animations';

export interface DanmakuComment {
  id: string;
  text: string;
  time: number; // in seconds
  color: string;
}

interface DanmakuLayerProps {
  comments: DanmakuComment[];
  currentTime: number; // current video time in seconds
  isPlaying: boolean;
  danmakuEnabled: boolean;
}

export default function DanmakuLayer({
  comments,
  currentTime,
  isPlaying,
  danmakuEnabled,
}: DanmakuLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shownIdsRef = useRef<Set<string>>(new Set());
  const activeTweensRef = useRef<DanmakuTween[]>([]);
  const lanesCount = 8; // Number of horizontal lanes
  const nextLaneRef = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // If user seeks backward, reset the shown set
  const prevTimeRef = useRef(currentTime);
  useEffect(() => {
    if (currentTime < prevTimeRef.current - 1.5) {
      shownIdsRef.current.clear();
      // Cancel active comments running
      activeTweensRef.current.forEach((t) => t.kill());
      activeTweensRef.current = [];
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    }
    prevTimeRef.current = currentTime;
  }, [currentTime]);

  // Pause / Resume GSAP animations based on play state
  useEffect(() => {
    activeTweensRef.current.forEach((tween) => {
      if (isPlaying) {
        tween.resume();
      } else {
        tween.pause();
      }
    });
  }, [isPlaying]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeTweensRef.current.forEach((t) => t.kill());
    };
  }, []);

  const shootDanmaku = useCallback((comment: DanmakuComment) => {
    const container = containerRef.current;
    if (!container) return;

    // Create danmaku element
    const el = document.createElement('div');
    el.className =
      'absolute whitespace-nowrap text-sm sm:text-base font-bold select-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.9)] pointer-events-none transition-shadow';

    // Enable will-change to notify browser to hardware-accelerate this element
    el.style.willChange = 'transform';
    el.style.transform = 'translate3d(0, 0, 0)';
    el.style.color = comment.color || '#FFFFFF';
    el.style.left = '100%';
    el.innerText = comment.text;

    // Assign a lane
    const lane = nextLaneRef.current;
    nextLaneRef.current = (nextLaneRef.current + 1) % lanesCount;

    // Lane height calculation
    const laneHeight = 32; // px per lane
    const topOffset = 16 + lane * laneHeight;
    el.style.top = `${topOffset}px`;

    container.appendChild(el);

    // Calculate animation speeds (randomized for organic feel)
    const containerWidth = container.offsetWidth;
    const elWidth = el.offsetWidth || 150; // Fallback
    const duration = 6 + Math.random() * 3; // 6 to 9 seconds travel time

    // GSAP travel animation - using GPU 3D acceleration
    const tween = animateDanmakuTravel(
      el,
      containerWidth + elWidth + 50,
      duration,
      !isPlayingRef.current,
      () => {
        // Remove element from DOM
        el.remove();
        // Remove from tracked active tweens list
        activeTweensRef.current = activeTweensRef.current.filter((t) => t !== tween);
      }
    );

    activeTweensRef.current.push(tween);
  }, []);

  // Trigger comments when currentTime updates
  useEffect(() => {
    if (!danmakuEnabled || !containerRef.current) return;

    const pendingComments = comments.filter(
      (c) => c.time >= currentTime - 0.5 && c.time <= currentTime && !shownIdsRef.current.has(c.id)
    );

    pendingComments.forEach((comment) => {
      shownIdsRef.current.add(comment.id);
      shootDanmaku(comment);
    });
  }, [currentTime, comments, danmakuEnabled, shootDanmaku]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 overflow-hidden pointer-events-none z-20 ${
        danmakuEnabled ? 'block' : 'hidden'
      }`}
    />
  );
}
