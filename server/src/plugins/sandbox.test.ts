import { describe, it, expect } from 'vitest';
import { PluginSandbox } from './sandbox';

const pluginCode = `
  globalThis.plugin = {
    async search(query) {
      return [{ id: 'item-' + query, title: 'Result for ' + query, cover: 'https://example.com/c.jpg' }];
    },
    async explore(type) {
      if (type !== 'anime') return [];
      return [{ id: 'featured-1', title: 'Featured Anime', cover: 'https://example.com/f.jpg' }];
    },
    async getContent(chapterId) {
      return 'chapter text for ' + chapterId;
    }
  };
`;

describe('PluginSandbox', () => {
  it('runs search inside the sandbox and returns structured data', async () => {
    const result = await new PluginSandbox(pluginCode).runMethod('search', ['naruto']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { id: 'item-naruto', title: 'Result for naruto', cover: 'https://example.com/c.jpg' },
    ]);
  });

  it('passes the media type argument through to explore', async () => {
    const anime = await new PluginSandbox(pluginCode).runMethod('explore', ['anime']);
    expect(anime.success).toBe(true);
    expect(anime.data).toHaveLength(1);

    const manga = await new PluginSandbox(pluginCode).runMethod('explore', ['manga']);
    expect(manga.success).toBe(true);
    expect(manga.data).toEqual([]);
  });

  it('returns plain string results', async () => {
    const result = await new PluginSandbox(pluginCode).runMethod('getContent', ['ch-1']);
    expect(result.success).toBe(true);
    expect(result.data).toBe('chapter text for ch-1');
  });

  it('fails gracefully when the plugin does not implement the method', async () => {
    const result = await new PluginSandbox(pluginCode).runMethod('getImages', ['ch-1']);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('fails gracefully on invalid plugin code', async () => {
    const result = await new PluginSandbox('this is not valid javascript {{{').runMethod('search', [
      'x',
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
