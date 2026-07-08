'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { User as UserIcon, LogOut, History, Settings, Blocks } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import AuthModal from './AuthModal';

export default function UserMenu() {
  const { user, logout } = useAuthStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  if (!user) {
    return (
      <>
        <button
          onClick={() => setModalOpen(true)}
          className="fixed top-6 right-6 z-50 flex items-center space-x-2 bg-surface/80 backdrop-blur-md border border-border text-textPrimary px-4 py-2.5 rounded-full hover:bg-surfaceLight hover:shadow-lg transition-all"
        >
          <UserIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">登录 / 注册</span>
        </button>
        <AuthModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  return (
    <div className="fixed top-6 right-6 z-50">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center space-x-2 bg-surface/80 backdrop-blur-md border border-border px-1.5 py-1.5 pr-4 rounded-full hover:bg-surfaceLight hover:shadow-lg transition-all"
      >
        <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-bold shadow-inner">
          {user.username.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm font-bold text-textPrimary max-w-[100px] truncate">
          {user.username}
        </span>
      </button>

      {dropdownOpen && (
        <div className="absolute top-14 right-0 w-48 bg-surface border border-border rounded-2xl shadow-xl overflow-hidden animate-fade-in origin-top-right">
          <div className="p-4 border-b border-border">
            <p className="text-xs text-textSecondary font-medium">当前账号</p>
            <p className="text-sm text-textPrimary font-bold truncate">{user.username}</p>
          </div>
          <Link
            href="/tracking"
            onClick={() => setDropdownOpen(false)}
            className="w-full flex items-center px-4 py-3 text-sm text-textPrimary hover:bg-surfaceLight transition-colors font-medium"
          >
            <History className="h-4 w-4 mr-2 text-primary" />
            我的追踪
          </Link>
          <Link
            href="/plugins"
            onClick={() => setDropdownOpen(false)}
            className="w-full flex items-center px-4 py-3 text-sm text-textPrimary hover:bg-surfaceLight transition-colors font-medium"
          >
            <Blocks className="h-4 w-4 mr-2 text-primary" />
            插件市场
          </Link>
          <Link
            href="/settings"
            onClick={() => setDropdownOpen(false)}
            className="w-full flex items-center px-4 py-3 text-sm text-textPrimary hover:bg-surfaceLight transition-colors font-medium"
          >
            <Settings className="h-4 w-4 mr-2 text-primary" />
            设置
          </Link>
          <button
            onClick={() => {
              logout();
              setDropdownOpen(false);
            }}
            className="w-full flex items-center px-4 py-3 text-sm text-rose-500 hover:bg-rose-500/10 transition-colors text-left font-medium"
          >
            <LogOut className="h-4 w-4 mr-2" />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
