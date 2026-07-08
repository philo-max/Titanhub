import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { PluginSandbox } from './sandbox';
import fs from 'fs/promises';
import path from 'path';

describe('MangaDex Plugin Sandboxed Integration', () => {
  let pluginCode = '';

  beforeAll(async () => {
    // Read the actual mangadex.js plugin code
    pluginCode = await fs.readFile(
      path.join(__dirname, 'mangadex.js'),
      'utf-8'
    );
  });

  beforeEach(() => {
    // Spy on global fetch
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    // Restore all mocked spies
    vi.restoreAllMocks();
  });

  it('performs search and parses nested relationships cover filename', async () => {
    const mockSearchResponse = {
      result: 'ok',
      data: [
        {
          id: 'manga-123',
          type: 'manga',
          attributes: {
            title: { en: 'Test Manga', ja: 'テスト漫画' },
            description: { en: 'A test manga description' }
          },
          relationships: [
            {
              type: 'cover_art',
              attributes: {
                fileName: 'cover-456.jpg'
              }
            }
          ]
        }
      ]
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify(mockSearchResponse),
    } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<any[]>('search', ['test query']);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual({
      id: 'manga-123',
      title: 'Test Manga',
      cover: 'https://uploads.mangadex.org/covers/manga-123/cover-456.jpg',
      description: 'A test manga description',
    });

    // Check fetch was called with the correct rating parameters
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('contentRating[]=safe'),
      expect.any(Object)
    );
  });

  it('performs explore and pulls popular list', async () => {
    const mockExploreResponse = {
      result: 'ok',
      data: [
        {
          id: 'popular-1',
          type: 'manga',
          attributes: {
            title: { en: 'Popular Manga' },
            description: { en: 'Description' }
          },
          relationships: []
        }
      ]
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify(mockExploreResponse),
    } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<any[]>('explore', ['manga']);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].title).toBe('Popular Manga');
    expect(result.data![0].cover).toContain('picsum.photos'); // Fallback cover
    expect(result.data![0].updateInfo).toBe('人气推荐');
  });

  it('gets detail and extracts author and tags', async () => {
    const mockDetailResponse = {
      result: 'ok',
      data: {
        id: 'manga-123',
        attributes: {
          title: { ja: 'ナルト' },
          status: 'ongoing',
          tags: [
            { attributes: { name: { en: 'Action' } } },
            { attributes: { name: { en: 'Adventure' } } }
          ]
        },
        relationships: [
          {
            type: 'author',
            attributes: {
              name: 'Masashi Kishimoto'
            }
          }
        ]
      }
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify(mockDetailResponse),
    } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<any>('getDetail', ['manga-123']);

    expect(result.success).toBe(true);
    expect(result.data!.title).toBe('ナルト');
    expect(result.data!.author).toBe('Masashi Kishimoto');
    expect(result.data!.genres).toEqual(['Action', 'Adventure']);
    expect(result.data!.status).toBe('连载中');
  });

  it('gets chapters and fallbacks to English if Chinese list is empty', async () => {
    const mockChineseEmptyResponse = { result: 'ok', data: [] };
    const mockEnglishResponse = {
      result: 'ok',
      data: [
        {
          id: 'chap-1',
          attributes: {
            chapter: '1.5',
            title: 'Side Story'
          }
        }
      ]
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify(mockChineseEmptyResponse),
      } as any)
      .mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify(mockEnglishResponse),
      } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<any[]>('getChapters', ['manga-123']);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual({
      id: 'chap-1',
      title: '第1.5话 Side Story',
      chapterNo: 1.5
    });

    // Verify it called first for Chinese then English
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('gets reader images via MangaDex At-Home server', async () => {
    const mockAtHomeResponse = {
      baseUrl: 'https://uploads.mangadex.org',
      chapter: {
        hash: 'chapterhash123',
        data: ['page1.png', 'page2.png']
      }
    };

    vi.mocked(global.fetch).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify(mockAtHomeResponse),
    } as any);

    const sandbox = new PluginSandbox('mangadex', pluginCode);
    const result = await sandbox.runMethod<string[]>('getImages', ['chap-1']);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      'https://uploads.mangadex.org/data/chapterhash123/page1.png',
      'https://uploads.mangadex.org/data/chapterhash123/page2.png',
    ]);
  });
});
