import './globals.css';
import type { Metadata, Viewport } from 'next';
import ServiceWorkerRegistrar from '../components/ServiceWorkerRegistrar';
import LocalDataBootstrap from '../components/LocalDataBootstrap';

export const metadata: Metadata = {
  title: 'Titanhub - ACG All-in-One Aggregation Platform',
  description: 'An open source aggregation platform for Anime, Manga, Novels, and Movies.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
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
      <body className="bg-background text-textPrimary min-h-screen antialiased">
        <ServiceWorkerRegistrar />
        <LocalDataBootstrap />
        {children}
      </body>
    </html>
  );
}
