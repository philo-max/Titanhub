'use client';

import { useEffect, useState } from 'react';
import { desktopBridge } from '@/lib/local-session';
import { useLocalSessionStore } from '@/stores/localSessionStore';
import { useSyncStore } from '@/stores/syncStore';
import { flushProgress } from '@/lib/progress-flush';

export default function LocalDataBootstrap() {
  const sessionError = useLocalSessionStore((state) => state.error);
  const syncError = useSyncStore((state) => state.error);
  const [retrying, setRetrying] = useState(false);

  const load = async () => {
    setRetrying(true);
    try {
      if (await useLocalSessionStore.getState().initialize()) {
        if (!(await useSyncStore.getState().flushLocalWrites())) return;
        await Promise.all([useSyncStore.getState().pullTracking(), useSyncStore.getState().pullFavorites()]);
      }
    } catch {
      return;
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    bridge.setFlushHandler?.(() => {
      flushProgress();
      return useSyncStore.getState().flushLocalWrites();
    });
    void load();
  }, []);

  if (!sessionError && !syncError) return null;
  return (
    <div role="alert" className="fixed bottom-6 left-6 right-6 z-[100] rounded-xl border border-rose-500/30 bg-surface p-4 text-sm text-textPrimary shadow-lg">
      <p>{sessionError || syncError} 待保存的修改会保留以便重试。</p>
      <button disabled={retrying} onClick={() => void load()} className="mt-2 text-primary disabled:opacity-50">
        {retrying ? '正在重试…' : '重试资料读写'}
      </button>
    </div>
  );
}
