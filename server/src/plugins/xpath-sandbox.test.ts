import { describe, it, expect } from 'vitest';
import { PluginSandbox } from './sandbox';
import { adaptKazumi } from '@titanhub/plugin-adapter';
import { PlaywrightSniffer } from './sniffer';

const htmlSource = `
  <!DOCTYPE html>
  <html>
  <body>
    <div class="container">
      <h1 class="title">测试页面</h1>
      <ul class="item-list">
        <li><a href="/anime/101" class="item-link">第一话 冒险开始</a></li>
        <li><a href="/anime/102" class="item-link">第二话 神秘的洞窟</a></li>
      </ul>
      <div class="sidebar">
        <span class="info-label" data-type="ranking">热度排名: 99</span>
      </div>
    </div>
  </body>
  </html>
`;

describe('XPath Sandbox htmlParser', () => {
  it('supports CSS selectors', async () => {
    const code = `
      globalThis.plugin = {
        async test(html) {
          return htmlParser.select(html, 'ul.item-list li a');
        }
      };
    `;
    const result = await new PluginSandbox(code).runMethod<any[]>('test', [htmlSource]);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data![0].text).toBe('第一话 冒险开始');
    expect(result.data![0].attrs.href).toBe('/anime/101');
  });

  it('supports XPath selectors for element lists', async () => {
    const code = `
      globalThis.plugin = {
        async test(html) {
          return htmlParser.select(html, '//ul[@class="item-list"]/li/a');
        }
      };
    `;
    const result = await new PluginSandbox(code).runMethod<any[]>('test', [htmlSource]);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data![0].text).toBe('第一话 冒险开始');
    expect(result.data![0].attrs.href).toBe('/anime/101');
  });

  it('supports XPath text node queries', async () => {
    const code = `
      globalThis.plugin = {
        async test(html) {
          return htmlParser.select(html, '//h1[@class="title"]/text()');
        }
      };
    `;
    const result = await new PluginSandbox(code).runMethod<any[]>('test', [htmlSource]);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].text).toBe('测试页面');
  });

  it('matches XPath on pages declaring a default xmlns namespace', async () => {
    const nsHtml =
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><ul class="item-list"><li><a href="/anime/201">命名空间章节</a></li></ul></body></html>';
    const code = `
      globalThis.plugin = {
        async test(html) {
          return htmlParser.select(html, '//ul[@class="item-list"]/li/a');
        }
      };
    `;
    const result = await new PluginSandbox(code).runMethod<any[]>('test', [nsHtml]);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].text).toBe('命名空间章节');
    expect(result.data![0].attrs.href).toBe('/anime/201');
  });

  it('keeps JSON-like plain text results as strings', async () => {
    const code = `
      globalThis.plugin = {
        async test() {
          return "42";
        }
      };
    `;
    const result = await new PluginSandbox(code).runMethod<string>('test', []);
    expect(result.success).toBe(true);
    expect(result.data).toBe('42');
  });

  it('supports global sniffVideo host binding', async () => {
    const originalSniff = PlaywrightSniffer.sniff;
    PlaywrightSniffer.sniff = async (url: string) => {
      if (url === 'http://example.com/play/101') {
        return 'http://example.com/stream.m3u8';
      }
      return '';
    };

    try {
      const code = `
        globalThis.plugin = {
          async getVideo(url) {
            return await sniffVideo(url, { 'User-Agent': 'Mozilla' });
          }
        };
      `;
      const result = await new PluginSandbox(code).runMethod<string>('getVideo', [
        'http://example.com/play/101',
      ]);
      expect(result.success).toBe(true);
      expect(result.data).toBe('http://example.com/stream.m3u8');
    } finally {
      PlaywrightSniffer.sniff = originalSniff;
    }
  });

  it('does not truncate a host sniff that outlasts the default JS timeout', async () => {
    const originalSniff = PlaywrightSniffer.sniff;
    // The interrupt handler only fires during JS bytecode execution; the sniff
    // resolves host-side after 300ms and its continuation is trivial, so even a
    // 100ms sandbox timeout must not truncate the result.
    PlaywrightSniffer.sniff = async () =>
      new Promise((resolve) => setTimeout(() => resolve('http://example.com/late.m3u8'), 300));

    const code = `
      globalThis.plugin = {
        async getVideo(url) { return await sniffVideo(url, {}); }
      };
    `;

    try {
      const result = await new PluginSandbox(code).runMethod<string>('getVideo', ['x'], 100);
      expect(result.success).toBe(true);
      expect(result.data).toBe('http://example.com/late.m3u8');
    } finally {
      PlaywrightSniffer.sniff = originalSniff;
    }
  });

  it('supports XPath attribute queries', async () => {
    const code = `
      globalThis.plugin = {
        async test(html) {
          return htmlParser.selectAttribute(html, '//span[@class="info-label"]', 'data-type');
        }
      };
    `;
    const result = await new PluginSandbox(code).runMethod<string>('test', [htmlSource]);
    expect(result.success).toBe(true);
    expect(result.data).toBe('ranking');
  });

  it('evaluates adapted Kazumi rules with XPath', async () => {
    const originalFetch = (global as any).fetch;
    const fetchMock = async (url: string) => {
      return {
        status: 200,
        text: async () => htmlSource,
        json: async () => ({}),
      };
    };
    (global as any).fetch = fetchMock;

    try {
      const rule = {
        name: 'Test Kazumi XPath Source',
        baseUrl: 'http://example.com',
        searchURL: 'http://example.com/search?q={keyword}',
        searchList: '//ul[@class="item-list"]/li',
        searchName: '//a',
        searchResult: '//a',
        chapterRoads: '//ul[@class="item-list"]',
        chapterResult: '//li/a',
      };

      const adapted = adaptKazumi(rule);
      expect(adapted.types).toEqual(['anime']);

      // Test search execution in sandbox
      const searchRes = await new PluginSandbox(adapted.code).runMethod<any[]>('search', ['test']);
      if (!searchRes.success) {
        console.error('searchRes error:', searchRes.error);
      }
      expect(searchRes.success).toBe(true);
      expect(searchRes.data).toHaveLength(2);
      expect(searchRes.data![0].title).toBe('第一话 冒险开始');
      expect(searchRes.data![0].id).toBe(encodeURIComponent('/anime/101'));

      // Test chapters execution in sandbox
      const chaptersRes = await new PluginSandbox(adapted.code).runMethod<any[]>('getChapters', [
        'anime-101',
      ]);
      expect(chaptersRes.success).toBe(true);
      expect(chaptersRes.data).toHaveLength(2);
      expect(chaptersRes.data![0].title).toBe('第一话 冒险开始');
      expect(chaptersRes.data![0].chapterNo).toBe(1);
    } finally {
      (global as any).fetch = originalFetch;
    }
  });
});
