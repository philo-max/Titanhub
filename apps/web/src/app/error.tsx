'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[GlobalError]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-textPrimary">
      <div className="max-w-md p-8 rounded-2xl border border-rose-500/20 bg-rose-500/5 text-center">
        <AlertTriangle className="h-10 w-10 text-rose-400 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-rose-400 mb-2">出了点问题</h2>
        <p className="text-sm text-textSecondary mb-6">
          页面加载时发生了意外错误。可以尝试重新加载，或返回首页。
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl bg-primary hover:bg-primary/90 text-white transition active:scale-95"
          >
            <RotateCcw className="h-4 w-4" />
            <span>重试</span>
          </button>
          <Link
            href="/"
            className="inline-flex items-center text-sm font-semibold px-4 py-2 rounded-xl bg-surface border border-border text-textPrimary hover:bg-surfaceLight transition"
          >
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
