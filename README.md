<p align="center">
  <img src="apps/web/public/icon-192.png" width="128" height="128" alt="Titanhub 手绘拟人 Logo" />
  <h1>Titanhub</h1>
  <p><strong>One App, All ACG Content.</strong></p>
  <p>Anime / Manga / Novel / Movie — 聚合搜索、追番追踪、弹幕播放，一站式搞定。</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Web-Next.js%2015-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Mobile-Flutter%203-blue?logo=flutter" alt="Flutter" />
  <img src="https://img.shields.io/badge/Desktop-Electron%2034-blue?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/API-Hono%20%2B%20Node.js-orange?logo=hono" alt="Hono" />
  <img src="https://img.shields.io/badge/DB-SQLite%20%2F%20PostgreSQL-blue?logo=sqlite" alt="SQLite / PostgreSQL" />
  <img src="https://img.shields.io/badge/Monorepo-Turborepo%20%2B%20pnpm-179297?logo=turborepo" alt="Turborepo" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT" />
</p>

---

## 项目简介

Titanhub 是一个面向 ACG 内容消费者的跨平台聚合平台。用户无需在多个应用间切换，一个 App 即可搜索、浏览、阅读和播放来自不同数据源（番剧、漫画、轻小说、影视）的内容，并支持跨设备追番进度同步。

项目采用 **Turborepo monorepo** 架构，包含四个核心子工程：

- **Web 前端** — Next.js 15 (App Router) + React 19 + Tailwind CSS v4 + GSAP 动效
- **Windows 桌面端** — Electron 34，内置 Web 前端与 API 服务，SQLite 保存本地资料，可选 WebDAV 手动同步
- **移动端** — Flutter 3 (Riverpod + Drift 本地数据库 + media_kit 播放器)
- **API 后端** — Hono (Bun/Node.js 双运行时) + Drizzle ORM + PostgreSQL

## 核心特性

### 1. Wasm 沙箱插件引擎 (Plugin Sandbox)

采用 `quickjs-emscripten` 在 WebAssembly 沙箱中安全执行第三方插件规则，通过 `cheerio` 解析桥实现原生 HTML DOM 操作。每个插件在隔离的 QuickJS 运行时中运行，主线程不受阻塞，恶意脚本无法访问宿主环境。

插件还支持 `xpath-sandbox`（XML Path 解析）和 `venera-adapter`（Venera 格式插件兼容），并提供 `plugin-adapter` 跨引擎适配层，同一套插件可在 Web Worker、Bun 后端和 Flutter 的 `flutter_js` 中运行。

### 2. 并行多源聚合搜索

前端通过并发的异步请求同时查询所有已加载的插件节点，结果实时合并，每个内容卡片自动标注来源标签（origin badge），用户可一键切换不同数据源。

### 3. 多类型内容阅读器

| 类型 | Web 端 | 移动端 |
|------|--------|--------|
| 漫画 | 水平翻页滑动 (GSAP 过渡动画) + 垂直长条滚动 | 多触控缩放平移 |
| 轻小说 | 沉浸式 Zen 模式，4 套排版主题（暗岩/薄荷/羊皮纸/亮色）+ 自定义字号 | 全屏阅读 + 主题切换 |
| 番剧/影视 | HLS.js 流媒体播放 + 弹幕层 | media_kit 原生播放器 |

### 4. GSAP GPU 加速动效

Web 端内容卡片实现了 144Hz 锁帧的 GPU 加速 3D 悬停倾斜效果（GSAP ticker loop），HeroBanner 轮播、页面切换均有流畅的过渡动画。

### 5. 追番追踪与跨端同步

浏览器部署沿用 JWT 账号与 PostgreSQL 追踪记录。Windows Electron 客户端无需注册，收藏及观看、阅读进度直接保存在本机，可选用自己的 WebDAV 手动同步。Flutter 与桌面的 WebDAV 互通尚未实现。

### 6. 弹幕系统

内置弹幕路由（`/danmaku`），支持弹幕获取、发送和增强过滤。

## 📥 客户端下载与使用指南 (v1.0.8)

当前已发布 [Titanhub v1.0.8](https://github.com/philo-max/Titanhub/releases/tag/v1.0.8)，本次附件为 **Windows x64 Electron 安装包**，包含新的手绘拟人 Logo 与视频快捷键：

1. 下载 [Titanhub-Setup-1.0.8-x64.exe](https://github.com/philo-max/Titanhub/releases/download/v1.0.8/Titanhub-Setup-1.0.8-x64.exe)。
2. 如已运行旧版，先正常退出程序，再运行安装向导；支持选择安装目录、创建快捷方式和系统卸载。
3. 安装后直接打开，无需注册、安装 Node.js/PostgreSQL 或手动启动后端，即可使用本地收藏与观看、阅读进度。

播放页支持：空格播放/暂停、左右键快退/快进 5 秒、上下键调节音量 5%、M 静音、F 全屏。输入弹幕时不会触发播放器快捷键。

Android、iOS 与 Flutter Windows 是独立构建目标，**v1.0.8 未提供这些平台的附件**。需要自行构建时，请参阅下方开发说明；后续下载以 [Releases](https://github.com/philo-max/Titanhub/releases) 实际附件为准。

> [!TIP]
> **本地联调与后端连接配置：**
> 
> Electron 已内置 API 服务；独立 Web 和 Flutter 客户端的开发联调需要配置后端连接。
> 1. **Windows 桌面端**：Electron 安装后直接启动，内置运行环境，无需用户另行安装 Node/PostgreSQL 或手动启动后端；旧 Flutter ZIP 仍按其服务器配置使用。
> 2. **Android 手机客户端**：
>    *   **模拟器**：默认路由到 `http://10.0.2.2:3001` 访问主机的本地服务。
>    *   **真机联调**：确保手机和电脑在**同一局域网（同一个 Wi-Fi）**下。在手机端搜索页右上方，**点击 Online/Offline 状态指示器**，在弹出的“配置服务器 URL”窗口中输入您电脑的局域网 IP（如 `http://192.168.1.100:3001`）并点击保存，客户端就会立刻动态刷新重载、重新请求获取数据源插件！

## Windows 本地资料与可选 WebDAV

Windows 新安装或旧版升级请使用已发布的 **1.0.8** 安装包。升级前先正常退出旧程序，无需清空本地资料；默认卸载也会保留用户资料。

首页、搜索和排行推荐已排除内置演示来源；部分来源失败时仍显示有效结果，可展开查看失败来源。Bangumi 提供番剧资料，不提供视频播放源，其他来源的播放和阅读能力仍需逐个适配、验证。来源可用性受站点规则与网络环境影响，搜索到内容不代表一定可以播放或阅读。

安装并打开 Electron 客户端后，无需注册即可收藏内容并保存观看、阅读进度；右上角「本地资料」可查看记录。正常退出会先保存最后进度，若保存失败，请按提示重试。

需要手动同步时：

1. 打开「设置 → 可选 WebDAV 同步」，填写自己的 WebDAV 服务器地址、用户名和密码，然后保存设置。
2. 默认使用 HTTPS。仅在明确接受用户名和密码可能明文传输时启用 HTTP 开关。
3. 点击「测试连接」，成功后点击「立即同步」。修改配置后需先保存；同步会先确认本地写入，再刷新收藏和进度。

密码不会回显；地址与账号不变时，密码留空可保留已保存值，更换地址或账号后须重新输入。未配置 WebDAV 时仍可正常使用本地资料。同步仅包括收藏与最近位置，不包括媒体文件、插件或账号凭据。目前已实现 Windows 手动同步，真实 NAS 兼容性仍待验证，手机互通尚未提供。

## Windows 安装包本地构建

面向开发者：

```bash
pnpm install --frozen-lockfile
pnpm package:desktop
```

- 正式安装包输出 `apps/desktop/build-out/Titanhub-Setup-<version>-x64.exe`。
- 内部调试用 `pnpm package:desktop:dir`，便携可选 `pnpm package:desktop:portable`。
- 安装/升级用户资料在 `userData`，默认卸载保留。
- 版本升级使用新的安装包覆盖安装。

## 技术架构

```
Titanhub/
├── apps/
│   ├── web/                     # Next.js 15 Web 前端
│   │   ├── src/
│   │   │   ├── app/             # App Router 页面 (anime/manga/novel/movie/search)
│   │   │   ├── components/      # UI 组件 (MediaCard, VideoPlayer, DanmakuLayer...)
│   │   │   ├── stores/          # Zustand 状态管理
│   │   │   └── lib/             # 工具函数与 GSAP 动画配置
│   │   └── package.json
│   ├── desktop/                 # Electron Windows 客户端
│   │   ├── src/main/            # 窗口、内置服务、本地会话与 WebDAV
│   │   ├── src/preload/         # 桌面桥接接口
│   │   └── package.json         # 版本与 NSIS 安装包配置
│   └── mobile/                  # Flutter 移动端
│       ├── lib/
│       │   ├── core/            # 路由、数据库、主题
│       │   ├── features/        # 媒体、播放器、阅读器、搜索、追踪
│       │   └── main.dart
│       └── pubspec.yaml
├── server/                      # Hono API 后端
│   ├── src/
│   │   ├── routes/              # RESTful 路由 (aggregate, auth, danmaku, sync)
│   │   ├── plugins/             # 插件引擎 (sandbox, sniffer, manager)
│   │   ├── auth/                # JWT 认证
│   │   ├── db/                  # Drizzle ORM schema + migrations
│   │   └── index.ts             # 服务入口
│   └── package.json
├── packages/
│   ├── plugin-types/            # 插件标准 TypeScript 接口定义
│   ├── plugin-adapter/          # 跨运行时插件适配层 (Web/Bun/Flutter)
│   └── theme/                   # 跨端主题 token (CSS 变量 → Flutter ThemeData)
├── docs/                         # 设计文档与开发规范
├── docker-compose.yml           # PostgreSQL 开发环境
├── turbo.json                    # Turborepo 管线配置
└── pnpm-workspace.yaml
```

### 技术栈一览

| 层级 | 技术选型 |
|------|----------|
| Web 框架 | Next.js 15 (App Router) + React 19 + TypeScript |
| 样式 | Tailwind CSS v4 + GSAP 3 动画 |
| 状态管理 | Zustand (Web) / Riverpod (Flutter) |
| 移动端 | Flutter 3 + Dart + go_router + Drift (SQLite) |
| Windows 桌面端 | Electron 34 + electron-builder (NSIS x64) |
| API 框架 | Hono + tsx (Node) / Bun 双运行时 |
| ORM | Drizzle ORM (type-safe schema → PostgreSQL migrations) |
| 数据库 | SQLite (Electron 本地资料) / PostgreSQL 15 (独立服务) |
| 认证 | Electron 本地会话 / JWT (独立服务，bcryptjs 密码哈希) |
| 插件引擎 | quickjs-emscripten (Wasm sandbox) + cheerio + xpath |
| 播放器 | HLS.js (Web) / media_kit (Flutter) |
| Monorepo | Turborepo + pnpm workspaces |
| CI/CD | GitHub Actions (Lint → Test → TypeCheck → Android APK build) |
| 测试 | Vitest (Web/Server/Desktop) / flutter_test (Mobile) |

## 快速开始

以下为源码开发流程。只使用 Windows 客户端时，下载安装包即可，无需准备这些环境。

### 前置要求

- **Node.js** >= 20 & **pnpm** >= 9
- **Bun** >= 1.0 (可选，server 支持 Bun 运行时)
- **Flutter** >= 3.x + Dart SDK (移动端)
- **Docker & Docker Compose** (数据库服务)

### 1. 启动数据库

```bash
docker compose up -d
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 DATABASE_URL 和 TOKEN_SECRET
```

### 4. 启动开发服务

一键启动 Web 前端 (`localhost:3000`) 和 API 后端 (`localhost:3001`)：

```bash
pnpm run dev
```

### 5. 运行 Flutter 客户端

```bash
cd apps/mobile
flutter pub get
flutter run
```

### 6. 运行测试

```bash
pnpm run test
```

## 插件系统

Titanhub 的核心竞争力在于可扩展的插件架构。每个插件是一个独立的 JS 规则文件，运行在安全的 QuickJS Wasm 沙箱中，定义了如何解析特定数据源的 HTML 结构。

- **`@titanhub/plugin-types`** 定义标准接口 (`TitanhubPlugin`, `MediaItem`, `Chapter` 等)
- **`@titanhub/plugin-adapter`** 提供跨运行时适配，同一插件可在 Web/Bun/Flutter 中执行
- **`server/plugins/sandbox.ts`** 后端插件沙箱，负责安全执行和超时控制
- **`server/plugins/sniffer.ts`** 自动识别内容类型并路由到对应插件

内置 MangaDex 真实插件作为参考实现。

## 项目结构说明

- `apps/web` — 基于 Next.js 15 App Router 的 SPA，包含番剧/漫画/轻小说/影视四大内容模块的完整页面、GSAP 动画引擎、HLS 播放器和弹幕层。
- `apps/mobile` — Flutter 跨端客户端，使用 Riverpod 状态管理 + Drift 本地持久化 + media_kit 原生播放，支持 Android/iOS/桌面。
- `apps/desktop` — Electron Windows 客户端，管理内置服务、本地会话、WebDAV 凭据与 NSIS 安装包。
- `server` — 轻量 Hono API，提供聚合搜索、JWT 认证、追番同步、弹幕 CRUD，通过 Drizzle ORM 管理 PostgreSQL。
- `packages/` — Monorepo 共享包，包含插件类型定义、跨运行时适配器和统一主题 token。
- `docs/` — 设计文档（Titanhub-Design.md）、插件开发指南、迭代记录。

## 许可证

[MIT](LICENSE)
