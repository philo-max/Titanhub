import { API_BASE } from './config';

export interface AlternativeSource {
  pluginId: string;
  pluginName: string;
  mediaId: string;
}

export interface FallbackResult extends AlternativeSource {
  chapterId: string;
  videos: { quality: string; url: string }[];
}

interface ChapterLike {
  id: string;
  chapterNo?: number;
}

export const MAX_FALLBACK_ATTEMPTS = 5;

const normalizeTitle = (title: string) => title.replace(/[\s\-:：·]/g, '').toLowerCase();

export function cleanTitle(title: string): string {
  const quoted = /《([^》]+)》/.exec(title);
  if (quoted) return quoted[1].trim();
  return title.split(/\s[-_|–—]\s|_|在线观看|高清/)[0].trim() || title.trim();
}

async function getJson(path: string, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE}${path}`, { signal });
  return response.json();
}

export async function findAlternativeSources(title: string, signal?: AbortSignal): Promise<AlternativeSource[]> {
  const query = cleanTitle(title);
  const data = await getJson(`/api/aggregate/search?q=${encodeURIComponent(query)}&type=anime`, signal);
  const target = normalizeTitle(query);
  const group = data.items?.find((item: { title: string }) => normalizeTitle(item.title) === target) || data.items?.[0];
  return (group?.sources || [])
    .filter((source: { providesVideo?: boolean }) => source.providesVideo)
    .map((source: { pluginId: string; pluginName: string; mediaId: string }) => ({
      pluginId: source.pluginId,
      pluginName: source.pluginName,
      mediaId: source.mediaId,
    }));
}

export function pickEpisode(chapters: ChapterLike[], episodeNo: number, index: number): ChapterLike | undefined {
  return chapters.find(chapter => chapter.chapterNo === episodeNo) || chapters[index];
}

export interface FallbackOptions {
  title: string;
  pluginId: string;
  mediaId: string;
  chapterId: string;
  tried: string[];
  onAttempt?: (source: AlternativeSource, attempt: number, total: number) => void;
  signal?: AbortSignal;
}

export async function findPlayableAlternative(options: FallbackOptions): Promise<FallbackResult | null> {
  const { title, pluginId, mediaId, chapterId, tried, onAttempt, signal } = options;
  const current = await getJson(`/api/plugins/${pluginId}/chapters/${mediaId}`, signal).catch(() => null);
  const currentChapters: ChapterLike[] = current?.chapters || [];
  const index = currentChapters.findIndex(chapter => chapter.id === chapterId);
  if (index < 0) return null;
  const episodeNo = currentChapters[index].chapterNo ?? index + 1;

  const skipped = new Set([pluginId, ...tried]);
  const alternatives = (await findAlternativeSources(title, signal).catch(() => []))
    .filter(source => !skipped.has(source.pluginId))
    .slice(0, MAX_FALLBACK_ATTEMPTS);

  for (const [position, source] of alternatives.entries()) {
    if (signal?.aborted) return null;
    onAttempt?.(source, position + 1, alternatives.length);
    try {
      const listing = await getJson(`/api/plugins/${source.pluginId}/chapters/${source.mediaId}`, signal);
      const chapter = pickEpisode(listing.chapters || [], episodeNo, index);
      if (!chapter) continue;
      const video = await getJson(`/api/plugins/${source.pluginId}/video/${chapter.id}`, signal);
      if (!video.error && Array.isArray(video.videos) && video.videos.length > 0) {
        return { ...source, chapterId: chapter.id, videos: video.videos };
      }
    } catch {
      continue;
    }
  }
  return null;
}
