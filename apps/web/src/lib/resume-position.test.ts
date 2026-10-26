import { describe, expect, it } from 'vitest';
import { findResumeLog, mangaResumePage, novelResumeRatio, videoResumeTime } from './resume-position';

describe('resume positions', () => {
  const log = { mediaType: 'anime', pluginId: 'source-a', mediaId: 'media', chapterId: 'chapter', progress: 0.5, position: 30 };

  it('matches the complete media and chapter identity', () => {
    expect(findResumeLog([log], log)).toBe(log);
    for (const identity of [
      { ...log, mediaType: 'movie' }, { ...log, pluginId: 'source-b' },
      { ...log, mediaId: 'other' }, { ...log, chapterId: 'other' },
      { ...log, chapterId: undefined },
    ]) expect(findResumeLog([log], identity)).toBeUndefined();
  });

  it('restores video seconds, including an explicit restart at zero', () => {
    expect(videoResumeTime(log, 100)).toBe(30);
    expect(videoResumeTime({ ...log, position: 0 }, 100)).toBe(0);
    expect(videoResumeTime({ progress: 0.5 }, 100)).toBe(50);
    expect(videoResumeTime({ progress: 2, position: 999 }, 100)).toBe(100);
  });

  it('handles unknown durations and invalid values', () => {
    for (const duration of [0, NaN, Infinity, -1]) expect(videoResumeTime(log, duration)).toBe(0);
    expect(videoResumeTime({ progress: NaN, position: NaN }, 100)).toBe(0);
    expect(videoResumeTime({ progress: 0.4, position: null }, 100)).toBe(40);
  });

  it('restores manga zero based pages and legacy ratios', () => {
    expect(mangaResumePage({ progress: 1, position: 0 }, 10)).toBe(0);
    expect(mangaResumePage({ progress: 0.1 }, 10)).toBe(0);
    expect(mangaResumePage({ progress: 0.5 }, 10)).toBe(4);
    expect(mangaResumePage({ progress: 1 }, 10)).toBe(9);
    expect(mangaResumePage({ progress: 1, position: 99 }, 10)).toBe(9);
    expect(mangaResumePage(log, 0)).toBe(0);
    expect(mangaResumePage({ progress: NaN }, 10)).toBe(0);
  });

  it('restores and clamps novel ratios', () => {
    expect(novelResumeRatio({ progress: 0.4 })).toBe(0.4);
    expect(novelResumeRatio({ progress: 0.4, position: 0 })).toBe(0);
    expect(novelResumeRatio({ progress: 0.4, position: 2 })).toBe(1);
    expect(novelResumeRatio({ progress: NaN, position: Infinity })).toBe(0);
    expect(novelResumeRatio(undefined)).toBe(0);
  });
});
