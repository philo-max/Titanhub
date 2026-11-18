'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { Chapter } from '@titanhub/plugin-types';
import { EPISODE_PAGE_SIZE, locateChapter, pageLabel, pageRanges, selectLinePage, type ChapterLine } from '@/lib/chapter-groups';

interface EpisodeSelectorProps<T extends Chapter> {
  lines: ChapterLine<T>[];
  activeChapterId?: string;
  activeLineId?: string;
  listClassName: string;
  renderEpisode: (chapter: T, active: boolean) => React.ReactNode;
}

interface Selection {
  line: number;
  page: number;
}

const tabClass = (selected: boolean) => `text-xs px-3 py-1.5 rounded-lg border font-semibold transition cursor-pointer ${
  selected
    ? 'bg-primary/20 border-primary/50 text-textPrimary'
    : 'bg-surface border-border text-textSecondary hover:text-textPrimary hover:border-surfaceLight'
}`;

export default function EpisodeSelector<T extends Chapter>({ lines, activeChapterId, activeLineId, listClassName, renderEpisode }: EpisodeSelectorProps<T>) {
  const activeLocation = useMemo(() => locateChapter(lines, activeChapterId, activeLineId), [lines, activeChapterId, activeLineId]);
  const initial = useMemo<Selection>(() => (
    activeLocation ? { line: activeLocation.line, page: Math.floor(activeLocation.index / EPISODE_PAGE_SIZE) } : { line: 0, page: 0 }
  ), [activeLocation]);
  const [selection, setSelection] = useState<Selection>(initial);

  useEffect(() => { setSelection(initial); }, [initial]);

  const line = lines[selection.line] ?? lines[0];
  if (!line) return null;
  const activeChapter = activeLocation && lines[activeLocation.line].chapters[activeLocation.index];
  const selectLine = (index: number) => {
    setSelection({ line: index, page: selectLinePage(lines, index, selection.page, activeChapter) });
  };
  const ranges = pageRanges(line.chapters.length);
  const range = ranges[selection.page] ?? ranges[0];

  return (
    <div className="space-y-4">
      {lines.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="线路">
          {lines.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={index === selection.line}
              onClick={() => selectLine(index)}
              className={tabClass(index === selection.line)}
            >
              {entry.name || `线路${index + 1}`}（{entry.chapters.length}）
            </button>
          ))}
        </div>
      )}
      {ranges.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="分段">
          {ranges.map((entry, index) => (
            <button
              key={entry.start}
              type="button"
              role="tab"
              aria-selected={index === selection.page}
              onClick={() => setSelection({ line: selection.line, page: index })}
              className={tabClass(index === selection.page)}
            >
              {pageLabel(line.chapters, entry)}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-textTertiary">本线路共 {line.chapters.length} 条</p>
      <div className={listClassName}>
        {line.chapters.slice(range?.start ?? 0, range?.end ?? 0).map((chapter) => renderEpisode(chapter, chapter === activeChapter))}
      </div>
    </div>
  );
}
