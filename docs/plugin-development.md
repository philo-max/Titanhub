# Titanhub 插件开发指南

插件是一段在服务端 WebAssembly QuickJS 沙箱中执行的 JavaScript，负责把任意数据源适配成 Titanhub 的统一媒体接口。

## 1. 插件结构

插件脚本执行后必须在 `globalThis.plugin` 上挂载一个对象：

```js
const plugin = {
  // 必需
  async search(query) {
    return [/* MediaItem */];
  },
  async getDetail(mediaId) {
    return {/* MediaDetail */};
  },
  async getChapters(mediaId) {
    return [/* Chapter */];
  },

  // 可选（按内容类型实现）
  async explore(type) {
    return [/* MediaItem，用于首页聚合 */];
  },
  async getVideoUrl(chapterId) {
    return [{ quality: '720p', url: '...' }];
  }, // anime / movie
  async getImages(chapterId) {
    return ['url1', 'url2'];
  }, // manga
  async getContent(chapterId) {
    return '章节正文文本';
  }, // novel
};

globalThis.plugin = plugin;
```

类型定义见 [`packages/plugin-types/index.ts`](../packages/plugin-types/index.ts)：

- `MediaItem`: `{ id, title, cover, description?, url?, updateInfo? }`
- `MediaDetail`: MediaItem + `{ status?, author?, genres?, lastUpdate? }`
- `Chapter`: `{ id, title, url?, chapterNo? }`

## 2. 沙箱环境

每次方法调用都在全新的 QuickJS 上下文中执行，**默认 5 秒超时**。可用的宿主 API：

| API                                                | 说明                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `fetch(url, options)`                              | 代理到宿主 fetch。返回对象含 `status`、`text()`、`json()`。支持自定义 method/headers/body |
| `htmlParser.select(html, selector)`                | 返回 JSON 字符串：`[{ text, html, attrs }]`，需 `JSON.parse`                              |
| `htmlParser.selectOne(html, selector)`             | 返回首个匹配的 JSON 字符串或 null                                                         |
| `htmlParser.selectText(html, selector)`            | 返回首个匹配元素的文本                                                                    |
| `htmlParser.selectAttribute(html, selector, attr)` | 返回首个匹配元素的指定属性值                                                              |
| `console.log / console.error`                      | 输出到服务端日志                                                                          |

选择器以 `/` 或 `//` 开头时按 **XPath 1.0** 执行（宿主先用 cheerio 转为良构 XHTML 再解析，自动剥离默认 xmlns），否则按 **CSS 选择器**（cheerio）执行。没有 DOM、没有 Node API、没有文件系统。CSS 模式不支持元素级嵌套选择，用组合选择器代替（如 `ul.list li a.title`）；XPath 模式可以对 `select` 返回项的 `html` 字段做子范围查询。

## 3. 最小示例

参考内置插件源码：

- [`bangumi.js`](../server/src/plugins/bangumi.js) —— 真实开放 API 插件（Bangumi 番组计划，含 explore 每日放送）
- [`mock-dmzj.js`](../server/src/plugins/mock-dmzj.js) —— HTML 抓取 + cheerio 桥解析示例
- [`mock-movie.js`](../server/src/plugins/mock-movie.js) —— 影视类型最小实现

## 4. 安装与管理

- **Web 插件市场**（`/plugins` 页面）：粘贴 JS 源码或 Kazumi JSON 规则安装；支持启停、卸载。写操作需登录。
- **API**：
  - `GET /api/plugins` 列表（不含源码）
  - `POST /api/plugins` 安装/更新 `{ id, name, types, code, version? }`（需 Bearer token）
  - `PATCH /api/plugins/:id` 启停 `{ isActive }`（需 token）
  - `DELETE /api/plugins/:id` 卸载（需 token）

## 5. 从 Kazumi / Venera 迁移

使用 `@titanhub/plugin-adapter`：

```ts
import { adaptKazumi, adaptVenera } from '@titanhub/plugin-adapter';

const plugin = adaptKazumi(kazumiJsonRule); // Kazumi JSON 规则
const plugin2 = adaptVenera(sourceCode, { id, name }); // Venera JS 源（对象式或 class 式）
// 得到 { id, name, version, types, code }，直接 POST /api/plugins 安装
```

已知限制：

- **Kazumi**：搜索 URL 支持 `@keyword`（官方格式）与 `{keyword}` 两种占位符；规则中的 `userAgent`/`referer` 会附加到请求头。**XPath 选择器已完整支持**（列表选择器 + 相对子选择器按项作用域求值，与 Kazumi 生态行为一致）；依赖 WebView 嗅探播放的规则（`useWebview: true`）无法转换。
- **Venera class 式源**：通过内置运行时 shim 执行（`Network` → fetch、`HtmlDocument` → cheerio 桥）。不支持元素级嵌套选择、UI/APP/存储 API；章节 ID 自动编码为 `comicId::epId`。
- **Venera 对象式源**：按方法名映射（`searchComics`/`loadComicInfo`/`loadEp` 等）。

## 6. 调试建议

1. 先用 `console.log` 在沙箱内打点，日志出现在服务端终端（`[Sandbox Plugin Log]` 前缀）。
2. 用 curl 直接调试单个方法：`curl "http://localhost:3001/api/plugins/<id>/search?q=测试"`。
3. 超过 5 秒的方法会被中断（`[Sandbox Timeout]`），网络慢的源注意减少串行请求。
4. 参考 [`server/src/plugins/venera-adapter.test.ts`](../server/src/plugins/venera-adapter.test.ts) 的写法，可以为插件写沙箱级单元测试。
