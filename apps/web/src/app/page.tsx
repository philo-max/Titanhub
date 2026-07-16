'use client';

import React from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import HeroBanner from '../components/HeroBanner';
import CategoryTabs from '../components/CategoryTabs';
import ContentGrid from '../components/ContentGrid';
import RankingSidebar from '../components/RankingSidebar';
import UserMenu from '../components/UserMenu';

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-textPrimary overflow-x-hidden font-sans selection:bg-primary/30">
      {/* Floating search — Spotify-style pill button */}
      <Link
        href="/search"
        className="fixed top-5 left-5 z-50 flex items-center gap-2 glass-surface border border-borderSubtle text-textPrimary px-4 py-2 rounded-pill hover:bg-surfaceLight hover:shadow-card transition-all duration-normal ease-out"
      >
        <Search className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">搜索</span>
      </Link>
      <UserMenu />
      <HeroBanner />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-20">
        <CategoryTabs />

        <div className="flex flex-col lg:flex-row gap-8 mt-8 items-start">
          <div className="flex-1 w-full min-w-0">
            <ContentGrid />
          </div>
          <RankingSidebar />
        </div>
      </main>
    </div>
  );
}
