import type { Chapter } from '@titanhub/plugin-types';

export const EPISODE_PAGE_SIZE = 100;

export interface ChapterLine<T extends Chapter = Chapter> {
  id: string;
  name: string;
  chapters: T[];
}

export interface ChapterLocation {
  line: number;
  index: number;
}

export interface PageRange {
  start: number;
  end: number;
}

const BOUNDARY = '(?=$|[\\s(（\\[【:：\\-—_·])';
const ARABIC_PATTERNS = [
  /^(\d+)$/,
  new RegExp(`^第\\s*(\\d+)\\s*[集话話回期]${BOUNDARY}`),
  new RegExp(`^(\\d+)\\s*[集话話]${BOUNDARY}`),
  new RegExp(`^(?:EP|E|Episode)\\.?\\s*(\\d+)${BOUNDARY}`, 'i'),
  /^(\d+)\.\s*(?=[^\d\s.])/,
  /^(0\d+)\s+(?=\S)/,
];
const CHINESE_PATTERN = new RegExp(`^第([零〇一二两三四五六七八九十百千]+)[集话話回期]${BOUNDARY}`);
const CHINESE_ZEROS = new Set(['零', '〇']);
const CHINESE_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CHINESE_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

function parseChineseNumber(text: string): number | undefined {
  let total = 0;
  let digit: number | undefined;
  let lastUnit = Infinity;
  for (const char of text) {
    if (CHINESE_ZEROS.has(char)) {
      if (digit !== undefined) return undefined;
      continue;
    }
    if (char in CHINESE_DIGITS) {
      if (digit !== undefined) return undefined;
      digit = CHINESE_DIGITS[char];
      continue;
    }
    const unit = CHINESE_UNITS[char];
    if (unit >= lastUnit) return undefined;
    total += (digit ?? (unit === 10 && total === 0 ? 1 : NaN)) * unit;
    digit = undefined;
    lastUnit = unit;
  }
  total += digit ?? 0;
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

export function episodeLabel(chapter: Chapter): string {
  const prefix = chapter.lineName ? `${chapter.lineName}·` : '';
  const title = chapter.title.trim();
  return prefix && title.startsWith(prefix) ? title.slice(prefix.length).trim() : title;
}

export function episodeNumber(chapter: Chapter): number | undefined {
  if (chapter.episodeNo !== undefined) {
    return Number.isInteger(chapter.episodeNo) && chapter.episodeNo >= 0 ? chapter.episodeNo : undefined;
  }
  const label = episodeLabel(chapter);
  for (const pattern of ARABIC_PATTERNS) {
    const match = pattern.exec(label);
    if (match) return Number(match[1]);
  }
  const chinese = CHINESE_PATTERN.exec(label);
  return chinese ? parseChineseNumber(chinese[1]) : undefined;
}

function sortLine<T extends Chapter>(chapters: T[]): T[] {
  const numbered = chapters
    .map((chapter, index) => ({ chapter, index, number: episodeNumber(chapter) }))
    .filter((entry): entry is { chapter: T; index: number; number: number } => entry.number !== undefined);
  const slots = numbered.map(entry => entry.index);
  const ordered = [...numbered].sort((left, right) => left.number - right.number || left.index - right.index);
  const result = [...chapters];
  slots.forEach((slot, position) => { result[slot] = ordered[position].chapter; });
  return result;
}

export function lineQuery(chapter: Chapter): string {
  const id = chapter.lineId ?? chapter.lineName;
  return id ? new URLSearchParams({ lineId: id }).toString() : '';
}

export function groupChapterLines<T extends Chapter>(chapters: T[]): ChapterLine<T>[] {
  const lines = new Map<string, ChapterLine<T>>();
  for (const chapter of chapters) {
    const id = chapter.lineId ?? chapter.lineName ?? '';
    const line = lines.get(id) ?? { id, name: chapter.lineName ?? chapter.lineId ?? '', chapters: [] };
    line.chapters.push(chapter);
    lines.set(id, line);
  }
  return [...lines.values()].map(line => ({ ...line, chapters: sortLine(line.chapters) }));
}

export function locateChapter(lines: ChapterLine[], chapterId: string | undefined, lineId?: string): ChapterLocation | undefined {
  if (!chapterId) return undefined;
  const matches = lines
    .map((entry, line) => ({ line, index: entry.chapters.findIndex(chapter => chapter.id === chapterId) }))
    .filter(location => location.index >= 0);
  const scoped = lineId === undefined ? undefined : matches.find(location => lines[location.line].id === lineId);
  return scoped ?? (matches.length === 1 ? matches[0] : undefined);
}

export function nextInLine<T extends Chapter>(lines: ChapterLine<T>[], chapterId: string, lineId?: string): T | undefined {
  const location = locateChapter(lines, chapterId, lineId);
  return location ? lines[location.line].chapters[location.index + 1] : undefined;
}

export function indexOfSameEpisode(line: ChapterLine, chapter: Chapter | undefined): number {
  const episode = chapter ? episodeNumber(chapter) : undefined;
  return episode === undefined ? -1 : line.chapters.findIndex(entry => episodeNumber(entry) === episode);
}

export function selectLinePage(lines: ChapterLine[], line: number, browsedPage: number, activeChapter: Chapter | undefined): number {
  const match = indexOfSameEpisode(lines[line], activeChapter);
  if (match >= 0) return Math.floor(match / EPISODE_PAGE_SIZE);
  const lastPage = Math.max(0, pageRanges(lines[line].chapters.length).length - 1);
  return Math.min(browsedPage, lastPage);
}

export function pageRanges(count: number, size = EPISODE_PAGE_SIZE): PageRange[] {
  return Array.from({ length: Math.ceil(count / size) }, (_, page) => ({ start: page * size, end: Math.min(count, (page + 1) * size) }));
}

export function pageLabel(chapters: Chapter[], range: PageRange): string {
  const first = episodeNumber(chapters[range.start]) ?? range.start + 1;
  const last = episodeNumber(chapters[range.end - 1]) ?? range.end;
  return `${first}-${last}`;
}
