import type { Chapter } from '@titanhub/plugin-types';
import { API_BASE } from './config';
import { episodeLabel, episodeNumber, groupChapterLines, locateChapter } from './chapter-groups';

export interface AlternativeSource {
  pluginId: string;
  pluginName: string;
  mediaId: string;
}

export interface FallbackResult extends AlternativeSource {
  chapterId: string;
  lineId?: string;
  videos: { quality: string; url: string }[];
}

export interface EpisodeKey {
  episode?: number;
  lineName?: string;
  label: string;
  single: boolean;
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

export function episodeKey(chapters: Chapter[], chapterId: string, lineId?: string): EpisodeKey | undefined {
  const lines = groupChapterLines(chapters);
  const location = locateChapter(lines, chapterId, lineId);
  if (!location) return undefined;
  const line = lines[location.line];
  const chapter = line.chapters[location.index];
  return { episode: episodeNumber(chapter), lineName: chapter.lineName, label: episodeLabel(chapter), single: chapters.length === 1 };
}

export function pickEpisode(chapters: Chapter[], key: EpisodeKey): Chapter | undefined {
  const lines = groupChapterLines(chapters);
  const ordered = [...lines.filter(line => key.lineName && line.name === key.lineName), ...lines.filter(line => !key.lineName || line.name !== key.lineName)];
  const candidates = ordered.flatMap(line => line.chapters);
  if (key.episode !== undefined) return candidates.find(chapter => episodeNumber(chapter) === key.episode);
  const sameLabel = key.label ? candidates.find(chapter => episodeNumber(chapter) === undefined && episodeLabel(chapter) === key.label) : undefined;
  return sameLabel ?? (key.single && chapters.length === 1 ? chapters[0] : undefined);
}

export interface FallbackOptions {
  title: string;
  pluginId: string;
  mediaId: string;
  chapterId: string;
  lineId?: string;
  tried: string[];
  onAttempt?: (source: AlternativeSource, attempt: number, total: number) => void;
  signal?: AbortSignal;
}

export async function findPlayableAlternative(options: FallbackOptions): Promise<FallbackResult | null> {
  const { title, pluginId, mediaId, chapterId, lineId, tried, onAttempt, signal } = options;
  const current = await getJson(`/api/plugins/${pluginId}/chapters/${mediaId}`, signal).catch(() => null);
  const key = episodeKey(current?.chapters || [], chapterId, lineId);
  if (!key) return null;

  const skipped = new Set([pluginId, ...tried]);
  const alternatives = (await findAlternativeSources(title, signal).catch(() => []))
    .filter(source => !skipped.has(source.pluginId))
    .slice(0, MAX_FALLBACK_ATTEMPTS);

  for (const [position, source] of alternatives.entries()) {
    if (signal?.aborted) return null;
    onAttempt?.(source, position + 1, alternatives.length);
    try {
      const listing = await getJson(`/api/plugins/${source.pluginId}/chapters/${source.mediaId}`, signal);
      const chapter = pickEpisode(listing.chapters || [], key);
      if (!chapter) continue;
      const video = await getJson(`/api/plugins/${source.pluginId}/video/${chapter.id}`, signal);
      if (!video.error && Array.isArray(video.videos) && video.videos.length > 0) {
        return { ...source, chapterId: chapter.id, lineId: chapter.lineId ?? chapter.lineName, videos: video.videos };
      }
    } catch {
      continue;
    }
  }
  return null;
}
