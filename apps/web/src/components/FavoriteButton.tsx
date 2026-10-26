'use client';

import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useLocalSessionStore } from '@/stores/localSessionStore';
import { FavoriteItem, mediaKey, useSyncStore } from '@/stores/syncStore';
import AuthModal from './AuthModal';

export default function FavoriteButton(item: Omit<FavoriteItem, 'id' | 'isDeleted'>) {
  const token = useAuthStore((state) => state.token);
  const localStatus = useLocalSessionStore((state) => state.status);
  const favorites = useSyncStore((state) => state.favoritesList);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const available = localStatus === 'ready' || (localStatus === 'idle' && Boolean(token));
  const favorite = favorites.some((entry) => mediaKey(entry) === mediaKey(item));

  useEffect(() => {
    let active = true;
    setLoaded(false);
    if (available) {
      useSyncStore.getState().pullFavorites().then(() => {
        if (active) setLoaded(true);
      }).catch(() => {
        if (active) setError('读取收藏失败，请点击重试。');
      });
    }
    return () => { active = false; };
  }, [available, token]);

  const toggle = async () => {
    if (!available) {
      if (localStatus === 'idle') setModalOpen(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!loaded) {
        await useSyncStore.getState().pullFavorites();
        setLoaded(true);
      } else {
        await useSyncStore.getState().toggleFavorite(item);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存收藏失败，请重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-5">
      <button type="button" disabled={busy || localStatus === 'loading'} onClick={() => void toggle()} aria-pressed={favorite} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm text-textPrimary hover:text-primary disabled:opacity-50">
        <Heart className={`h-4 w-4 ${favorite ? 'fill-rose-400 text-rose-400' : ''}`} />
        {busy ? '正在保存…' : favorite ? '取消收藏' : '收藏'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-rose-400">{error}</p>}
      <AuthModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
