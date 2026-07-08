import './globals.css';
import type { Metadata, Viewport } from 'next';
import ServiceWorkerRegistrar from '../components/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: 'Titanhub - ACG All-in-One Aggregation Platform',
  description: 'An open source aggregation platform for Anime, Manga, Novels, and Movies.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Titanhub',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
