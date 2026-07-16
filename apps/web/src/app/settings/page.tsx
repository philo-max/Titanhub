'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Database,
  Info,
  LogOut,
  Settings as SettingsIcon,
  User as UserIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { API_BASE } from '@/lib/config';

export default function SettingsPage() {
  const { user, logout } = useAuthStore();
  const [cleared, setCleared] = useState(false);

  const clearLocalCache = () => {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('titanhub-'))
      .forEach((key) => localStorage.removeItem(key));
    setCleared(true);
  };

  return (
    <div className="min-h-screen bg-background text-textPrimary pb-24">
      <div className="max-w-2xl mx-auto px-6 pt-12">
        <Link
          href="/"
          className="inline-flex items-center space-x-2 text-textSecondary hover:text-textPrimary transition mb-10 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">返回发现</span>
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight mb-8 flex items-center" style={{ letterSpacing: '-0.025em' }}>
          <SettingsIcon className="h-6 w-6 text-primary mr-3" />
          设置
        </h1>

        <section className="rounded-xl bg-surface border border-borderSubtle p-6 mb-4 shadow-card">
          <h2 className="text-xs font-medium text-textTertiary uppercase tracking-wider mb-4 flex items-center">
            <UserIcon className="h-4 w-4 mr-2" />
            账号
          </h2>
          {user ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-white font-bold">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-bold">{user.username}</p>
                  <p className="text-xs text-textSecondary">已登录，进度将同步到云端</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="flex items-center text-xs font-semibold px-3 py-2 rounded-xl text-rose-500 border border-rose-500/20 hover:bg-rose-500/10 transition"
              >
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                退出登录
              </button>
            </div>
          ) : (
            <p className="text-sm text-textSecondary">
              未登录。返回首页点击右上角「登录 / 注册」。
            </p>
          )}
        </section>

        <section className="rounded-2xl bg-surface border border-border p-6 mb-6">
          <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-4 flex items-center">
            <Database className="h-4 w-4 mr-2" />
            数据
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">清除本地缓存</p>
              <p className="text-xs text-textSecondary mt-1">
                清除浏览器中保存的登录状态与本地数据（云端数据不受影响）。
              </p>
            </div>
            <button
              onClick={clearLocalCache}
              className="text-xs font-semibold px-3 py-2 rounded-xl bg-surfaceLight border border-border hover:bg-surface transition flex-shrink-0 ml-4"
            >
              {cleared ? '已清除' : '清除'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-surface border border-border p-6">
          <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-4 flex items-center">
            <Info className="h-4 w-4 mr-2" />
            关于
          </h2>
          <div className="space-y-2 text-sm text-textSecondary">
            <p>Titanhub — ACG 全内容聚合平台</p>
            <p>
              API 服务器:{' '}
              <code className="text-xs bg-surfaceLight px-1.5 py-0.5 rounded">{API_BASE}</code>
            </p>
            <p>内容由已安装的沙箱插件动态提供，本应用不存储任何媒体资源。</p>
          </div>
        </section>
      </div>
    </div>
  );
}
