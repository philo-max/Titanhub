'use client';

import { API_BASE } from './config';
import { DanmakuComment } from '@/components/DanmakuLayer';

export interface VideoSource {
  quality: string;
  url: string;
}

export interface CachedPlaybackData {
  sources?: VideoSource[];
  comments?: DanmakuComment[];
  images?: string[];
  timestamp: number;
}

// In-memory cache singleton.
// Key format: `${pluginId}:${chapterId}`
const cache = new Map<string, CachedPlaybackData>();

// Keep cache entries for up to 10 minutes (600,000ms)
const CACHE_TTL = 10 * 60 * 1000;

function getCacheKey(pluginId: string, chapterId: string): string {
  return `${pluginId}:${chapterId}`;
}

export const playbackCache = {
  /**
   * Pre-fetches playback resources (video/danmaku for anime, images list for manga),
   * storing them in memory cache.
   */
  async prefetch(pluginId: string, mediaId: string, chapterId: string, mediaType: 'anime' | 'manga'): Promise<void> {
    const key = getCacheKey(pluginId, chapterId);
    
    // If it's already prefetching or cached, don't duplicate request
    if (cache.has(key)) {
      const existing = cache.get(key);
      if (existing && Date.now() - existing.timestamp < CACHE_TTL) {
        return;
      }
    }

    try {
      if (mediaType === 'manga') {
        const res = await fetch(`${API_BASE}/api/plugins/${pluginId}/images/${chapterId}`).then(r => r.json());
        if (res && res.images && res.images.length > 0) {
          cache.set(key, {
            images: res.images,
            timestamp: Date.now()
          });
        }
      } else {
        // Fire fetch calls concurrently for anime
        const [videoRes, danmakuRes] = await Promise.all([
          fetch(`${API_BASE}/api/plugins/${pluginId}/video/${chapterId}`).then(r => r.json()),
          fetch(`${API_BASE}/api/danmaku/${pluginId}/${mediaId}/${chapterId}`).then(r => r.json())
        ]);

        if (videoRes && videoRes.videos && videoRes.videos.length > 0) {
          cache.set(key, {
            sources: videoRes.videos,
            comments: danmakuRes.comments || [],
            timestamp: Date.now()
          });
        }
      }
    } catch (err) {
      console.warn(`[PlaybackCache] Prefetch failed for ${mediaType} chapter ${chapterId}:`, err);
    }
  },

  /**
   * Synchronously checks if preloaded data exists and is valid.
   */
  get(pluginId: string, chapterId: string): CachedPlaybackData | null {
    const key = getCacheKey(pluginId, chapterId);
    const entry = cache.get(key);
    
    if (!entry) return null;
    
    // Check expiration
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
      return null;
    }
    
    return entry;
  },

  /**
   * Removes a specific entry from the cache
   */
  delete(pluginId: string, chapterId: string): void {
    cache.delete(getCacheKey(pluginId, chapterId));
  },

  /**
   * Clears the entire playback cache
   */
  clear(): void {
    cache.clear();
  }
};
