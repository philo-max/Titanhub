import { describe, it, expect } from 'vitest';
import { adaptVenera } from '@titanhub/plugin-adapter';
import { PluginSandbox } from './sandbox';

const veneraClassSource = `
class TestSource extends ComicSource {
  name = "测试源"
  key = "test"
  version = "1.0.0"

  search = {
    load: async (keyword, options, page) => {
      log('searching', keyword, 'page', page);
      return {
        comics: [
          { id: 'c1', title: 'Comic ' + keyword, cover: 'https://example.com/c1.jpg', description: 'desc1' },
        ],
        maxPage: 1,
      };
    }
  }

  comic = {
    loadInfo: async (id) => ({
      title: 'Comic ' + id,
      cover: 'https://example.com/' + id + '.jpg',
      description: 'detail of ' + id,
      tags: { '类型': ['热血', '冒险'], '状态': ['连载中'] },
      chapters: { 'ep1': '第一话', 'ep2': '第二话' },
    }),
    loadEp: async (comicId, epId) => ({
      images: ['https://example.com/' + comicId + '/' + epId + '/1.jpg'],
    }),
  }
}
`;

describe('Venera class source running inside the real sandbox', () => {
  const plugin = adaptVenera(veneraClassSource, { id: 'venera-test', name: 'Venera 测试源' });

  it('search maps comics to MediaItems', async () => {
    const result = await new PluginSandbox(plugin.code).runMethod<any[]>('search', ['naruto']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        id: 'c1',
        title: 'Comic naruto',
        cover: 'https://example.com/c1.jpg',
        description: 'desc1',
      },
    ]);
  });

  it('getDetail flattens tag namespaces into genres', async () => {
    const result = await new PluginSandbox(plugin.code).runMethod<any>('getDetail', ['c1']);
    expect(result.success).toBe(true);
    expect(result.data.title).toBe('Comic c1');
    expect(result.data.genres).toEqual(['热血', '冒险', '连载中']);
  });

  it('getChapters encodes comicId::epId composite ids', async () => {
    const result = await new PluginSandbox(plugin.code).runMethod<any[]>('getChapters', ['c1']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { id: 'c1::ep1', title: '第一话', chapterNo: 1 },
      { id: 'c1::ep2', title: '第二话', chapterNo: 2 },
    ]);
  });

  it('getImages decodes the composite id back into loadEp arguments', async () => {
    const result = await new PluginSandbox(plugin.code).runMethod<string[]>('getImages', [
      'c1::ep2',
    ]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['https://example.com/c1/ep2/1.jpg']);
  });
});
