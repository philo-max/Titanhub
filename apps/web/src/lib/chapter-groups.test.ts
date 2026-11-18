import { describe, expect, it } from 'vitest';
import {
  EPISODE_PAGE_SIZE, episodeLabel, episodeNumber, groupChapterLines, indexOfSameEpisode, lineQuery, locateChapter, nextInLine, pageLabel, pageRanges, selectLinePage,
} from './chapter-groups';

const ep = (no: number, extra: Record<string, unknown> = {}) => ({ id: `id-${no}`, title: `第${no}集`, ...extra });
const ids = (chapters: { id: string }[]) => chapters.map(chapter => chapter.id);

function shuffle<T>(items: T[], seed = 7): T[] {
  const copy = [...items];
  let state = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const swap = state % (index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

describe('episodeNumber', () => {
  it('reads explicit numeric episode titles only', () => {
    const titles: Array<[string, number | undefined]> = [
      ['1', 1], ['0999', 999], ['第1000集', 1000], ['第 1001 话', 1001], ['EP12', 12], ['ep.7', 7], ['第12集 云霄飞车杀人事件', 12],
      ['第十二集', 12], ['第一百零一话', 101], ['第一千集', 1000], ['12话', 12],
      ['第12.5集', undefined], ['12.5', undefined], ['SP1', undefined], ['OVA', undefined], ['剧场版2 世纪末的魔术师', undefined],
      ['名侦探柯南 2', undefined], ['柯南2020特别篇', undefined], ['全集', undefined], ['', undefined],
    ];
    for (const [title, expected] of titles) expect(episodeNumber({ id: title, title }), title).toBe(expected);
  });

  it('reads conservative numbered subtitles without guessing years or decimals', () => {
    const titles: Array<[string, number | undefined]> = [
      ['01 启程', 1], ['0012 新的事件', 12], ['1001. 终结', 1001], ['1001.终结', 1001], ['01. 序章', 1],
      ['12.5 总集篇', undefined], ['12.5. 总集篇', undefined], ['2024 名侦探柯南', undefined], ['1 启程', undefined],
      ['2024. ', undefined], ['01', 1], ['剧场版 2024', undefined],
    ];
    for (const [title, expected] of titles) expect(episodeNumber({ id: title, title }), title).toBe(expected);
  });

  it('prefers a plugin supplied integer episodeNo and ignores positional chapterNo', () => {
    expect(episodeNumber({ id: 'a', title: '特别篇', episodeNo: 42 })).toBe(42);
    expect(episodeNumber({ id: 'a', title: '正片', chapterNo: 3 })).toBeUndefined();
    expect(episodeNumber({ id: 'a', title: '第3集', episodeNo: 3.5 })).toBeUndefined();
  });

  it('strips the line prefix from labels before parsing', () => {
    const chapter = { id: 'a', title: '线路2·第1集', lineId: 'line-2', lineName: '线路2' };
    expect(episodeLabel(chapter)).toBe('第1集');
    expect(episodeNumber(chapter)).toBe(1);
    expect(episodeNumber({ id: 'b', title: '线路2·第1集' })).toBeUndefined();
  });
});

describe('groupChapterLines', () => {
  it('keeps legacy chapters without line metadata as one line in natural order', () => {
    const lines = groupChapterLines([ep(10), ep(2), ep(1), ep(1000), ep(999), ep(1001)]);
    expect(lines).toHaveLength(1);
    expect(ids(lines[0].chapters)).toEqual(['id-1', 'id-2', 'id-10', 'id-999', 'id-1000', 'id-1001']);
  });

  it('does not treat separator titles as lines without metadata', () => {
    const lines = groupChapterLines([{ id: 'a', title: '线路1·第1集' }, { id: 'b', title: '线路2·第1集' }]);
    expect(lines).toHaveLength(1);
    expect(ids(lines[0].chapters)).toEqual(['a', 'b']);
  });

  it('sorts 1200 shuffled or reversed episodes ascending', () => {
    const all = Array.from({ length: 1200 }, (_, index) => ep(index + 1));
    const expected = ids(all);
    expect(ids(groupChapterLines(shuffle(all))[0].chapters)).toEqual(expected);
    expect(ids(groupChapterLines([...all].reverse())[0].chapters)).toEqual(expected);
  });

  it('keeps unknown, special and decimal entries in place and duplicates stably', () => {
    const input = [
      { id: 'sp', title: 'SP1' }, ep(3), { id: 'half', title: '第2.5集' }, ep(2, { id: 'dup-a' }), ep(1), ep(2, { id: 'dup-b' }), { id: 'movie', title: '剧场版' },
    ];
    expect(ids(groupChapterLines(input)[0].chapters)).toEqual(['sp', 'id-1', 'half', 'dup-a', 'dup-b', 'id-3', 'movie']);
  });

  it('splits structured lines in first appearance order with their own counts', () => {
    const chapters = [
      ...[2, 1, 3].map(no => ep(no, { id: `a${no}`, lineId: 'line-1', lineName: 'A' })),
      ...[1, 2].map(no => ep(no, { id: `b${no}`, lineId: 'line-2', lineName: 'B' })),
    ];
    const lines = groupChapterLines(chapters);
    expect(lines.map(line => [line.id, line.name, line.chapters.length])).toEqual([['line-1', 'A', 3], ['line-2', 'B', 2]]);
    expect(ids(lines[0].chapters)).toEqual(['a1', 'a2', 'a3']);
    expect(ids(lines[1].chapters)).toEqual(['b1', 'b2']);
  });
});

describe('navigation and paging', () => {
  const chapters = [
    ...Array.from({ length: 1200 }, (_, index) => ep(1200 - index, { id: `a${1200 - index}`, lineId: 'line-1', lineName: 'A' })),
    ...[1, 2].map(no => ep(no, { id: `b${no}`, lineId: 'line-2', lineName: 'B' })),
  ];
  const lines = groupChapterLines(chapters);

  it('locates the current chapter line and page', () => {
    expect(locateChapter(lines, 'a1001')).toEqual({ line: 0, index: 1000 });
    expect(Math.floor(1000 / EPISODE_PAGE_SIZE)).toBe(10);
    expect(locateChapter(lines, 'b2')).toEqual({ line: 1, index: 1 });
    expect(locateChapter(lines, 'missing')).toBeUndefined();
    expect(locateChapter(lines, undefined)).toBeUndefined();
  });

  it('moves to the next episode inside the same line only', () => {
    expect(nextInLine(lines, 'a999')?.id).toBe('a1000');
    expect(nextInLine(lines, 'a1200')).toBeUndefined();
    expect(nextInLine(lines, 'b1')?.id).toBe('b2');
    expect(nextInLine(lines, 'b2')).toBeUndefined();
  });

  it('finds the same real episode in another line without guessing unknown ones', () => {
    expect(indexOfSameEpisode(lines[1], lines[0].chapters[1])).toBe(1);
    expect(indexOfSameEpisode(lines[1], lines[0].chapters[1100])).toBe(-1);
    expect(indexOfSameEpisode(lines[1], { id: 'sp', title: 'SP' })).toBe(-1);
    expect(indexOfSameEpisode(lines[1], undefined)).toBe(-1);
  });

  it('keeps duplicate chapter ids scoped to the requested line', () => {
    const shared = groupChapterLines([
      { id: 'same', title: '第1集', lineId: 'a' }, { id: 'a2', title: '第2集', lineId: 'a' },
      { id: 'same', title: '第1集', lineId: 'b' }, { id: 'b2', title: '第2集', lineId: 'b' },
    ]);
    expect(locateChapter(shared, 'same', 'b')).toEqual({ line: 1, index: 0 });
    expect(nextInLine(shared, 'same', 'b')?.id).toBe('b2');
    expect(nextInLine(shared, 'same', 'a')?.id).toBe('a2');
    expect(locateChapter(shared, 'same')).toBeUndefined();
    expect(nextInLine(shared, 'same')).toBeUndefined();
    expect(locateChapter(shared, 'same', 'missing')).toBeUndefined();
    expect(locateChapter(shared, 'b2')).toEqual({ line: 1, index: 1 });
    expect(locateChapter(shared, 'b2', 'stale')).toEqual({ line: 1, index: 1 });
    expect(nextInLine(lines, 'b1', 'line-2')?.id).toBe('b2');
  });

  it('builds an optional line query from structured metadata only', () => {
    expect(lineQuery({ id: 'x', title: '第1集', lineId: 'line 2&x' })).toBe('lineId=line+2%26x');
    expect(lineQuery({ id: 'x', title: '第1集', lineName: 'B' })).toBe('lineId=B');
    expect(lineQuery({ id: 'x', title: '第1集' })).toBe('');
  });

  it('keeps the browsed page when switching lines without a matching episode', () => {
    const long = groupChapterLines([
      ...Array.from({ length: 1200 }, (_, index) => ep(index + 1, { id: `a${index + 1}`, lineId: 'a' })),
      ...Array.from({ length: 1200 }, (_, index) => ep(index + 1, { id: `c${index + 1}`, lineId: 'c' })),
      ...[1, 2].map(no => ep(no, { id: `b${no}`, lineId: 'b' })),
      { id: 'sp', title: 'SP', lineId: 'd' }, ...Array.from({ length: 250 }, (_, index) => ({ id: `d${index}`, title: `特别篇${index}`, lineId: 'd' })),
    ]);
    expect(selectLinePage(long, 1, 10, undefined)).toBe(10);
    expect(selectLinePage(long, 2, 10, undefined)).toBe(0);
    expect(selectLinePage(long, 3, 10, undefined)).toBe(2);
    expect(selectLinePage(long, 1, 0, long[0].chapters[1050])).toBe(10);
    expect(selectLinePage(long, 1, 3, { id: 'sp', title: 'SP', lineId: 'd' })).toBe(3);
  });

  it('pages each line by one hundred episodes with episode number labels', () => {
    const ranges = pageRanges(lines[0].chapters.length);
    expect(ranges).toHaveLength(12);
    expect(ranges[11]).toEqual({ start: 1100, end: 1200 });
    expect(pageLabel(lines[0].chapters, ranges[0])).toBe('1-100');
    expect(pageLabel(lines[0].chapters, ranges[10])).toBe('1001-1100');
    expect(pageRanges(0)).toEqual([]);
    expect(pageLabel([{ id: 'x', title: 'SP' }, { id: 'y', title: 'OVA' }], { start: 0, end: 2 })).toBe('1-2');
  });
});
