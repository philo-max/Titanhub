import { describe, it, expect } from 'vitest';
import { adaptLNReader } from './index';

describe('adaptLNReader', () => {
  it('should convert an LNReader plugin source to Titanhub format', () => {
    const source = `
      class TestNovelSource {
        get source() {
          return {
            site: 'https://example.com',
            icon: 'icon.png',
            name: 'Test Novels',
          };
        }

        async popularNovels(page) {
          return [
            { name: 'Novel 1', path: '/novel/1', cover: '/covers/1.jpg' },
            { name: 'Novel 2', path: '/novel/2', cover: '/covers/2.jpg' },
          ];
        }

        async parseNovelAndChapters(novelUrl) {
          return {
            name: 'Novel 1',
            cover: '/covers/1.jpg',
            summary: 'A test novel.',
            author: 'Test Author',
            chapters: [
              { name: 'Chapter 1', path: '/novel/1/ch1' },
              { name: 'Chapter 2', path: '/novel/1/ch2' },
            ],
          };
        }

        async parseChapter(chapterUrl) {
          return '<p>Chapter content here.</p>';
        }

        async searchNovels(query, page) {
          return [
            { name: query + ' Result', path: '/novel/99', cover: '' },
          ];
        }
      }

      var source = new TestNovelSource();
    `;

    const result = adaptLNReader(source, {
      id: 'lnreader-test',
      name: 'Test Novels',
      version: '1.0.0',
    });

    expect(result.id).toBe('lnreader-test');
    expect(result.name).toBe('Test Novels');
    expect(result.version).toBe('1.0.0');
    expect(result.types).toEqual(['novel']);
    expect(result.code).toContain('LNReader runtime shim');
    expect(result.code).toContain('require');
    expect(result.code).toContain('cheerio');
    expect(result.code).toContain('dayjs');
    expect(result.code).toContain('fetchApi');
    expect(result.code).toContain('NovelStatus');
    expect(result.code).toContain('globalThis.plugin');
    // Verify the original source is included
    expect(result.code).toContain('TestNovelSource');
    expect(result.code).toContain('popularNovels');
    expect(result.code).toContain('parseNovelAndChapters');
    expect(result.code).toContain('parseChapter');
    expect(result.code).toContain('searchNovels');
  });

  it('should include the require() shim with all standard LNReader packages', () => {
    const result = adaptLNReader('// empty source', {
      id: 'test',
      name: 'Test',
    });

    // Verify all standard LNReader require() packages are mapped
    expect(result.code).toContain("case 'cheerio'");
    expect(result.code).toContain("case 'htmlparser2'");
    expect(result.code).toContain("case 'dayjs'");
    expect(result.code).toContain("case '@libs/fetch'");
    expect(result.code).toContain("case '@libs/novelStatus'");
    expect(result.code).toContain("case '@libs/isAbsoluteUrl'");
    expect(result.code).toContain("case '@libs/filterInputs'");
    expect(result.code).toContain("case '@libs/defaultCover'");
    expect(result.code).toContain("case '@libs/storage'");
  });

  it('should include string extensions from mangayomi', () => {
    const result = adaptLNReader('// empty', { id: 'test', name: 'Test' });

    expect(result.code).toContain('substringAfter');
    expect(result.code).toContain('substringAfterLast');
    expect(result.code).toContain('substringBefore');
    expect(result.code).toContain('substringBeforeLast');
  });

  it('should include polyfills (FormData, etc.)', () => {
    const result = adaptLNReader('// empty', { id: 'test', name: 'Test' });

    expect(result.code).toContain('class FormData');
    expect(result.code).toContain('fetchApi');
  });
});
