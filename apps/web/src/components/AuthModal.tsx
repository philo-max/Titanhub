'use client';

import React, { useState, useRef, useEffect } from 'react';
import { X, Loader2, User, KeyRound } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useSyncStore } from '../stores/syncStore';
import { animateModalOpen, animateModalClose, animateShake } from '../lib/animations';
import { API_BASE } from '@/lib/config';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const modalRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const setAuth = useAuthStore((state) => state.setAuth);
  const { pullTracking, pullFavorites } = useSyncStore();

  useEffect(() => {
    if (isOpen) {
      animateModalOpen(overlayRef.current, modalRef.current);
      // Reset state
      setUsername('');
      setPassword('');
      setError('');
      setMode('login');
    }
  }, [isOpen]);

  const handleClose = () => {
    animateModalClose(overlayRef.current, modalRef.current, onClose);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || 'Authentication failed');
      }

      // Success
      setAuth(data.token, data.user);

      // Pull initial data
      await pullTracking();
      await pullFavorites();

      handleClose();
    } catch (err: any) {
      setError(err.message);
      animateShake(modalRef.current);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop overlay */}
      <div
        ref={overlayRef}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal Dialog */}
      <div
        ref={modalRef}
        className="relative w-full max-w-md bg-surface border border-border rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Header graphic */}
        <div className="h-32 bg-gradient-to-br from-primary/20 to-accent/10 relative flex items-center justify-center">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
          <div className="bg-surface p-3 rounded-2xl shadow-lg border border-border z-10">
            <User className="h-8 w-8 text-primary" />
          </div>
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-2 bg-background/50 hover:bg-background rounded-full text-textSecondary hover:text-textPrimary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form area */}
        <div className="p-8 pt-6">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-textPrimary">
              {mode === 'login' ? '欢迎回来' : '创建新账号'}
            </h2>
            <p className="text-sm text-textSecondary mt-1">
              {mode === 'login'
                ? '登录以跨端同步您的阅读与播放进度'
                : '注册并加入 Titanhub，开启云端同步'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-textSecondary mb-1.5 ml-1">
                用户名
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User className="h-4 w-4 text-textSecondary" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl pl-11 pr-4 py-3 text-sm text-textPrimary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  placeholder="输入用户名"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-textSecondary mb-1.5 ml-1">
                密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <KeyRound className="h-4 w-4 text-textSecondary" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl pl-11 pr-4 py-3 text-sm text-textPrimary focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                  placeholder={mode === 'login' ? '输入密码' : '设置不少于6位的密码'}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-medium flex items-start">
                <span className="mr-2">⚠️</span>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90 disabled:opacity-70 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-primary/25 mt-2 flex items-center justify-center"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : mode === 'login' ? (
                '立即登录'
              ) : (
                '立即注册'
              )}
            </button>
          </form>

          {/* Toggle mode */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
              }}
              className="text-xs text-textSecondary hover:text-primary transition-colors font-medium"
            >
              {mode === 'login' ? '没有账号？点击注册' : '已有账号？点击登录'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
