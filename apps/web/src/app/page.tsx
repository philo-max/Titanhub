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
    <div className="min-h-screen bg-[#0a0a0a] text-white overflow-x-hidden font-sans selection:bg-purple-500/30">
      <Link
        href="/search"
        className="fixed top-6 left-6 z-50 flex items-center space-x-2 bg-surface/80 backdrop-blur-md border border-border text-textPrimary px-4 py-2.5 rounded-full hover:bg-surfaceLight hover:shadow-lg transition-all"
      >
        <Search className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold">搜索</span>
      </Link>
      <UserMenu />
      <HeroBanner />

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8 relative z-20">
        <CategoryTabs />

        <div className="flex flex-col lg:flex-row gap-10 mt-8 items-start">
          <div className="flex-1 w-full min-w-0">
            <ContentGrid />
          </div>
          <RankingSidebar />
        </div>
      </main>
    </div>
  );
}
