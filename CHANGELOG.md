# Changelog

All notable changes to **Titanhub** are documented in this file.

## [1.1.2] - 2026-11-22 (Android `1.1.2+27` / Desktop `1.1.2`)

### Fixed
- **JM / Venera 漫画网络通道与代理兼容**：重构 `MainlandHttpOverrides` 与 `MainlandDohProxy`，优先尊重系统 HTTP 代理（`findProxyFromEnvironment`）及 VPN/TUN Fake-IP 网段（`198.18.0.0/15`），仅在系统连接失败时回退大陆 DoH（`223.5.5.5` / `1.12.12.12`），解决与 Venera 同环境下境外漫画源无法打开的问题。
- **JM / Venera 反混淆图片加载（`modifyImage`）**：
  - 修复 `VeneraImageProxy` 拼接脚本时缺少分号引发的 JS ASI `TypeError: not a function`（此前导致章节图 502 裂图）；
  - 修复 `package:image` v4 `compositeImage` 未传 `dstW`/`dstH` 导致切片纵向拉伸重影的问题；
  - 统一 `sendMessage` JSON 序列化并将图片解码/拼图/编码迁移至后台 `Isolate.run`，主线程串行 QuickJS 仅记录切块指令，彻底消除卡顿与并发崩溃，同时对同图请求去重。
- **Accept-Encoding 兼容**：在 `VeneraHost`、`VeneraSource`、`VeneraImageProxy` 统一移除 `Accept-Encoding` 中的 `br`/`zstd`，交由 Dart `HttpClient` 自动协商 `gzip` 解压，修复部分 CDN 返回 `zstd`/`br` 导致的解析失败。
- **全漫画源封面请求头（`onThumbnailLoad`）**：在 `venera_shim_bridge` 接入 `onThumbnailLoad` 并在发现页、搜索结果页、详情页透传 `httpHeaders`，覆盖 JM、漫画柜、漫画人、GoDa、nhentai、ehentai、hitomi 等 16 个依赖 Referer 的 Venera 漫画源。
- **小说阅读与书源**：
  - 持久化小说阅读偏好（主题、滚屏/翻页模式、字号、行距、字体）及自定义 Legado 书源（`legado_sources.json`）；
  - 新增「上一章 / 目录 / 下一章」快捷导航、翻页边缘切章、目录抽屉自动定位、章节内 `[IMG:url]` 插图渲染与加载失败重试；
  - 清理哔哩轻小说（Linovelib）无效 UI 标签、修复多页正文拼接与封面绑定、修复 Legado 相对目录/章节 URL 解析；
  - 优化小说页顶部「+ 导入书源」布局与漫画/小说章节卡片图标。

### Added
- **番剧权威榜单**：接入 Bilibili PGC 大陆直连高清榜单（热门榜 / 高分榜 / 新作榜 / 每日新番）。
- **详情页自动匹配可用源**：在详情页自动探测并展示可播放/可读的聚合来源栏。
- **桌面客户端同步**：`titanhub-desktop` 版本同步至 `1.1.2`，`titanhub-server` 生产包同步更新。

---

## [1.1.1] - 2026-11-21 (Android `1.1.1+19` ~ `1.1.1+24`)

### Added
- **全链路源健康巡检**：升级为 `search -> getChapters -> getImages/getVideoUrl` 端到端探针。
- **书架与历史管理**：支持书架/历史记录长按删除与清空历史。
- **标签搜索与跳转**：适配 Venera `categoryComics` 标签路由与详情页标签点击直达搜索（含成人源）。
- **小说模块**：新增内置大陆直连哔哩轻小说源（`LinovelibSource`）与 Legado JSON 书源导入运行器。
- **大陆直连通道**：新增 `MainlandDohProxy`、Bangumi 大陆直连镜像（`api.bgmapi.com`）与 Kazumi 风格三列动漫排行界面，隐藏影视占位模块。

---

## [1.1.0] - 2026-11-19

- 移动端多 Tab ACG 聚合门户（动漫 / 漫画 / 书架 / 源中心）、本地 QuickJS Venera/Kazumi 源运行时与 WebDAV 跨端同步验收版。
