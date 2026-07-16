import { Loader2 } from 'lucide-react';

export default function Loading() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center text-textPrimary">
      <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
      <p className="text-sm text-textSecondary">加载中...</p>
    </div>
  );
}
