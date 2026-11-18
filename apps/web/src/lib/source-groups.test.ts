import { describe, expect, it } from 'vitest';
import { groupSourceVersions, sourceVersionLabel } from './source-groups';

describe('source versions grouped for display only', () => {
  it('groups case-insensitive site names while preserving every language and implementation identity', () => {
    const sources = [
      { id: 'venera', name: 'MangaDex', type: 'manga', sourceType: 'venera' },
      { id: 'zh', name: 'mangadex', type: 'manga', sourceType: 'mangayomi', lang: 'zh' },
      { id: 'en', name: 'MangaDex', type: 'manga', sourceType: 'mangayomi', lang: 'en' },
    ];
    const groups = groupSourceVersions(sources);
    expect(groups).toHaveLength(1);
    expect(groups[0].versions.map(source => source.id)).toEqual(['venera', 'zh', 'en']);
    expect(sourceVersionLabel(sources[1])).toContain('简中');
    expect(sourceVersionLabel(sources[2])).toContain('英语');
  });

  it('does not collapse a multi-account implementation or a different media category', () => {
    expect(groupSourceVersions([
      { id: 'a', name: '拷贝漫画', type: 'manga' },
      { id: 'b', name: '拷贝漫画(多账号)', type: 'manga' },
      { id: 'c', name: '拷贝漫画', type: 'novel' },
    ])).toHaveLength(3);
  });

  it('separates installed same-name sources by media types and ignores types order', () => {
    const installed = [
      { id: 'manga-a', name: 'Sample', types: ['manga'] },
      { id: 'anime-a', name: 'sample', types: ['anime'] },
      { id: 'mixed-a', name: 'Sample', types: ['manga', 'anime'] },
      { id: 'mixed-b', name: 'SAMPLE', types: ['anime', 'manga'] },
      { id: 'manga-b', name: 'Sample ', types: ['manga'] },
    ];
    const groups = groupSourceVersions(installed);
    expect(groups.map(group => group.versions.map(source => source.id))).toEqual([['manga-a', 'manga-b'], ['anime-a'], ['mixed-a', 'mixed-b']]);
    expect(installed[2].types).toEqual(['manga', 'anime']);
  });
});
