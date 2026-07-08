# Titanhub -- ACG 全内容聚合平台设计文档

> 状态：MVP 开发中 | 作者：philo-max
> 最后更新：2026-07-07
> 说明：本文档已对齐当前代码实现；标注「规划」的内容尚未实现。

---

## 1. 项目定位

**Titanhub** 是一个开源的 ACG（影视 / 动漫 / 漫画 / 轻小说）全内容聚合平台。核心理念：

> 一个应用，看遍所有 ACG 内容。

与现有项目的对比：

| 维度     | Kazumi    | Venera  | Mangayomi | **Titanhub**  |
| -------- | --------- | ------- | --------- | ------------- |
| 动漫     | ✅        | ❌      | ✅        | ✅            |
| 影视     | ❌        | ❌      | ❌        | ✅            |
| 漫画     | ❌        | ✅      | ✅        | ✅            |
| 轻小说   | ❌        | ❌      | ✅        | ✅            |
| 弹幕     | ✅        | ❌      | ❌        | ✅            |
| Web 端   | ❌        | ❌      | ❌        | ✅            |
| 插件系统 | JSON 规则 | JS 引擎 | Dart 插件 | JS 引擎       |
| 跨平台   | Flutter   | Flutter | Flutter   | Flutter + Web |

**差异化优势：**

1. **四合一聚合** -- 影视 / 动漫 / 漫画 / 轻小说 统一入口
2. **Web 端覆盖** -- GSAP 驱动的高品质 Web 客户端，填补现有方案空白
3. **统一插件引擎** -- 一套 JS/JSON 规则同时覆盖四种内容源
4. **跨端数据同步** -- 追番/追漫/阅读进度云端同步

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端层                              │
├──────────┬──────────┬──────────┬──────────┐               │
│ Android  │   iOS    │ Desktop  │   Web    │               │
│ (Flutter)│ (Flutter)│ (Flutter)│(Next.js  │               │
│          │          │          │ +GSAP)   │               │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┘               │
     │          │          │          │                       │
┌────▼──────────▼──────────▼──────────▼──────────────────────┐
│                    统一 API 网关层                           │
│              (REST + WebSocket + SSE)                       │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                    后端服务层                                │
├──────────┬──────────┬──────────┬──────────┐                │
│ 插件引擎 │ 内容聚合 │ 用户系统 │ 同步服务 │                │
│(JS/Dart) │ (爬虫/   │(Auth/    │(进度/收藏│                │
│          │ 规则解析)│ 收藏夹)  │  书签)   │                │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┘                │
     │          │          │          │                       │
┌────▼──────────▼──────────▼──────────▼──────────────────────┐
│                    数据层                                    │
├──────────┬──────────┬──────────┐                            │
│ SQLite/  │ PostgreSQL│  Redis  │                            │
│(本地缓存) │(云端)     │(缓存/   │                            │
│          │           │ 弹幕)   │                            │
└──────────────────────────────────┘                            │
```

---

## 3. 技术栈选型（Ponytail 原则：最小够用）

### 3.1 移动端 / 桌面客户端 -- Flutter

直接沿用 Kazumi / Venera 已验证的 Flutter 技术栈，不重复造轮子。

| 模块       | 技术                 | 选型理由                                                          |
| ---------- | -------------------- | ----------------------------------------------------------------- |
| 框架       | Flutter 3.x + Dart   | 跨平台一套代码，Kazumi/Venera 已验证                              |
| 状态管理   | Riverpod 2.x         | 声明式，轻量，Flutter 社区主流                                    |
| 本地数据库 | Drift (SQLite)       | 类型安全的 ORM，离线优先                                          |
| 视频播放   | media_kit (libmpv)   | Kazumi 已验证，支持弹幕叠加                                       |
| 路由       | go_router            | 官方推荐，声明式路由                                              |
| 网络       | dio                  | 成熟稳定，拦截器灵活                                              |
| 图片加载   | cached_network_image | Flutter 标配                                                      |
| 漫画阅读器 | 自绘 (CustomPainter) | 参照 Venera 实现，支持翻页/条漫/双页                              |
| 小说阅读器 | 自绘 (RichText)      | 参照 LNReader 实现逻辑，并借鉴 Readest 的原生多主题及字号缩放机制 |

### 3.2 Web 前端 -- Next.js + GSAP

| 模块     | 技术                               | 选型理由                                                                        |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| 框架     | Next.js 15 (App Router) + React 19 | SSR + SSG，SEO 友好，生态成熟                                                   |
| 动画     | **GSAP 3.12+**                     | 本次核心技能，高性能 DOM 动画                                                   |
| UI 库    | Tailwind CSS v4                    | 原子化 CSS，零运行时，配合 GSAP 最佳                                            |
| 状态管理 | Zustand 5                          | 极简，1KB，够用                                                                 |
| 视频播放 | hls.js + 自研播放器组件            | HLS 流播放，弹幕层（DanmakuLayer）自绘                                          |
| 漫画阅读 | GSAP 翻页 + 条漫滚动（DOM 渲染）   | 横向分页滑动过渡与纵向条漫连续滚动两种模式                                      |
| 小说阅读 | 自研排版引擎                       | 段落/注释/自定义字体支持，学习 Readest 的 Zen Mode 沉浸式阅读布局与选文高亮功能 |

### 3.3 后端 -- Node.js (Hono)

| 模块     | 技术                        | 选型理由                                                                |
| -------- | --------------------------- | ----------------------------------------------------------------------- |
| 运行时   | Node.js 20+ (tsx)，兼容 Bun | 开发用 `tsx watch`；保留 `dev:bun` / `start:bun` 备选脚本               |
| 框架     | Hono                        | 超轻量，edge-compatible，不搞 NestJS 那套                               |
| 数据库   | PostgreSQL + Drizzle ORM    | 云端数据，生产级，类型安全 schema                                       |
| 缓存     | Redis                       | 弹幕推送、会话缓存（docker-compose 已配，代码尚未接入）                 |
| 认证     | bcryptjs + JWT (hono/jwt)   | 密码 bcrypt 哈希；HS256 签名 token，30 天过期，密钥经 TOKEN_SECRET 配置 |
| 插件引擎 | quickjs-emscripten (WASM)   | 安全沙箱执行用户 JS 插件，宿主侧 cheerio 提供 HTML 解析桥               |
| 文件存储 | S3 兼容 (MinIO)             | 备份/头像/插件包（docker-compose 已配，代码尚未接入）                   |

### 3.4 Ponytail 审计备忘

```
// ponytail: 初始版本不做以下内容，等用户要求再补
- GraphQL (REST 够用，少一层抽象)
- 微服务拆分 (单体先跑，Per-user 数据量不大)
- 自建搜索引擎 (MeiliSearch 或 Postgres全文索引)
- CI/CD (先手动构建)
- 国际化 (先中文，要再加)
```

---

## 4. 插件系统设计

核心设计思想：**借鉴 Venera 的 JS 引擎 + Kazumi 的 JSON 规则，统一为一种插件格式。**

### 4.1 插件类型

```typescript
// 每个插件声明自己支持的内容类型
interface TitanhubPlugin {
  id: string;
  name: string;
  version: string;
  // ponytail: union type 替代四个独立接口，减少模板代码
  types: ('anime' | 'manga' | 'novel' | 'movie')[];

  // 通用接口 -- 所有类型共用
  search(query: string): Promise<MediaItem[]>;
  getDetail(id: string): Promise<MediaDetail>;
  getChapters(id: string): Promise<Chapter[]>;

  // 类型特有接口（按需实现）
  getVideoUrl?(chapterId: string): Promise<VideoSource[]>; // anime / movie
  getImages?(chapterId: string): Promise<string[]>; // manga
  getContent?(chapterId: string): Promise<string>; // novel
}
```

### 4.2 插件执行环境

**当前实现**：插件统一在**后端**执行——`quickjs-emscripten` WASM 沙箱运行插件 JS，宿主侧通过 cheerio 桥提供 HTML 解析能力（`server/src/plugins/sandbox.ts`）。客户端（Flutter / Web）不本地执行插件，统一调用 REST API：

```
GET /api/plugins/:id/search?q=...
GET /api/plugins/:id/detail/:mediaId
GET /api/plugins/:id/chapters/:mediaId
GET /api/plugins/:id/video/:chapterId    # anime / movie
GET /api/plugins/:id/images/:chapterId   # manga
GET /api/plugins/:id/content/:chapterId  # novel
```

**规划**（离线场景，未实现）：

- **移动端/桌面端**：Dart 侧通过 `flutter_js` (QuickJS bindings) 本地执行
- **Web 端**：Web Worker 中通过 quickjs-emscripten 本地执行，与主线程隔离

### 4.3 规则兼容（`packages/plugin-adapter`）

支持从 Kazumi（JSON 规则）和 Venera（对象式与 class 式 JS 源）做适配器导入。宿主 htmlParser 桥同时支持 **CSS 选择器（cheerio）与 XPath 1.0**（以 `/` 或 `//` 开头自动分派，cheerio 先转良构 XHTML 再交给 xmldom + xpath 求值），Kazumi 规则的 XPath 选择器可直接使用。class 式 Venera 源通过内置运行时 shim 执行（`Network` → 沙箱 fetch、`HtmlDocument` → htmlParser 桥，章节 ID 编码为 `comicId::epId`）。已知限制：依赖 WebView 嗅探的 Kazumi 播放规则无法转换；Venera shim 不支持 UI/存储 API。Web 端插件市场页支持 JS / Kazumi JSON / Venera 源三种导入方式。开发指南见 `docs/plugin-development.md`：

```
Kazumi JSON 规则 → 适配器 → Titanhub JS 插件
Venera JS 源     → 适配器 → Titanhub JS 插件
```

---

## 5. GSAP 动画方案（Web 前端）

Web 端是 GSAP 的主战场，核心动画场景：

### 5.1 首页 -- 沉浸式内容发现

```
┌────────────────────────────────────────────┐
│  Hero Banner (视差滚动 + 文字入场动画)      │
│  GSAP: ScrollTrigger scrub 绑定           │
│  - 背景图 scale 1.0 → 1.15               │
│  - 标题 SplitText 字符交错入场              │
│  - 描述段落 fade + y 偏移                  │
├────────────────────────────────────────────┤
│  分类标签栏 (FLIP 过渡动画)                  │
│  GSAP: Flip.getState() + Flip.from()       │
│  - 切换分类时卡片重新排列的平滑过渡          │
├────────────────────────────────────────────┤
│  内容卡片网格 (交错入场)                     │
│  GSAP: from + stagger                      │
│  - 每个卡片 y:80 → 0, opacity:0 → 1       │
│  - stagger: { each: 0.08, from: "start" }  │
│  - ScrollTrigger toggleActions: play/reverse│
├────────────────────────────────────────────┤
│  排行榜侧边栏 (数字滚动动画)                 │
│  GSAP: gsap.to(number, { textContent })    │
├────────────────────────────────────────────┤
│  页面转场 (View Transition API + GSAP)      │
│  - 列表 → 详情：卡片 Flip 放大到全屏        │
│  - 详情 → 播放器：淡入淡出                  │
└────────────────────────────────────────────┘
```

### 5.2 播放器页面

```
┌────────────────────────────────────────────┐
│  播放器控制栏 (hover 时滑入滑出)              │
│  GSAP: to/from + autoPlay: false            │
├────────────────────────────────────────────┤
│  弹幕系统 (CSS transform 驱动)               │
│  GSAP: 大量 DOM 元素动画                     │
│  - 每条弹幕 x: 100% → -100%                │
│  - stagger 随机延迟模拟真实弹幕密度           │
│  - will-change: transform + force3D: true   │
├────────────────────────────────────────────┤
│  选集面板 (Slide + Fade)                    │
│  GSAP: timeline 编排 slideIn + fadeIn       │
└────────────────────────────────────────────┘
```

### 5.3 漫画阅读器

```
┌────────────────────────────────────────────┐
│  翻页效果 (3D 翻页或滑动)                    │
│  GSAP: rotationY + transformPerspective    │
├────────────────────────────────────────────┤
│  页面切换 (Swipe + Fade)                    │
│  GSAP: Draggable.create() 拖拽手势          │
├────────────────────────────────────────────┤
│  条漫模式 (滚动 scrub)                      │
│  GSAP: ScrollTrigger scrub 控制阅读进度      │
└────────────────────────────────────────────┘
```

### 5.4 轻小说阅读器

```
┌────────────────────────────────────────────┐
│  章节切换 (淡入淡出 + 文字逐段入场)           │
│  GSAP: SplitText lines 交错入场              │
├────────────────────────────────────────────┤
│  进度指示器 (滑动条动画)                      │
│  GSAP: to 进度条宽度                         │
├────────────────────────────────────────────┤
│  设置面板 (Drawer 抽屉滑入)                   │
│  GSAP: x: 300 → 0                          │
└────────────────────────────────────────────┘
```

---

## 6. 数据模型

实际 schema 以 `server/src/db/schema.ts`（Drizzle ORM）为准，以下为示意：

```sql
-- ponytail: 单体数据库，不拆 microservices

-- 用户
users (
  id          UUID PRIMARY KEY,
  username    VARCHAR(32) UNIQUE NOT NULL,
  password    VARCHAR(255),           -- bcrypt hash
  avatar_url  TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
)

-- 追踪记录（统一四种内容类型）
tracking (
  id          UUID PRIMARY KEY,
  user_id     UUID REFERENCES users,
  media_type  ENUM('anime','manga','novel','movie'),
  media_id    VARCHAR(255) NOT NULL,  -- 插件id + 内容id 的组合
  plugin_id   VARCHAR(255) NOT NULL,
  chapter_no  INTEGER DEFAULT 0,
  chapter_id  VARCHAR(255),          -- 当前章节标识
  progress    FLOAT DEFAULT 0,       -- 0~1 阅读进度
  status      ENUM('watching','completed','plan_to','dropped'),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, media_id)
)

-- 收藏
favorites (
  id          UUID PRIMARY KEY,
  user_id     UUID REFERENCES users,
  media_type  ENUM('anime','manga','novel','movie'),
  media_id    VARCHAR(255) NOT NULL,
  plugin_id   VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, media_id)
)

-- 插件
plugins (
  id          UUID PRIMARY KEY,
  identifier  VARCHAR(255) UNIQUE NOT NULL,
  name        VARCHAR(255) NOT NULL,
  version     VARCHAR(16),
  types       VARCHAR(255),          -- 逗号分隔: "anime,manga"
  author      VARCHAR(128),
  code        TEXT NOT NULL,         -- JS 源码
  is_builtin  BOOLEAN DEFAULT FALSE,
  install_count INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,  -- 是否启用（参与聚合查询）
  created_at  TIMESTAMP DEFAULT NOW()
)

-- 弹幕池
danmaku (
  id          BIGSERIAL PRIMARY KEY,
  media_id    VARCHAR(255) NOT NULL,
  plugin_id   VARCHAR(255) NOT NULL,
  episode     VARCHAR(64) NOT NULL,
  time_offset FLOAT NOT NULL,        -- 秒
  content     TEXT NOT NULL,
  color       VARCHAR(7) DEFAULT '#FFFFFF',
  user_hash    VARCHAR(32),          -- 匿名化用户标识
  created_at  TIMESTAMP DEFAULT NOW()
)
```

---

## 7. 项目目录结构

当前实际结构（「规划」注释表示尚未创建）：

```
Titanhub/
├── apps/
│   ├── mobile/                  # Flutter 移动端 + 桌面端
│   │   ├── lib/
│   │   │   ├── core/            # network / router / storage (Drift) / theme
│   │   │   ├── features/        # 按功能拆分（屏幕本身类型无关）
│   │   │   │   ├── media/       # 通用数据层 (models/providers) + 详情页
│   │   │   │   ├── search/      # 全局搜索
│   │   │   │   ├── player/      # 视频播放器（动漫/影视）
│   │   │   │   ├── reader/      # 漫画阅读器 + 小说阅读器
│   │   │   │   └── tracking/    # 进度同步 + 登录对话框
│   │   │   └── main.dart
│   │   └── pubspec.yaml
│   │   # 规划: plugins/ 本地插件引擎 (flutter_js)
│   │
│   └── web/                     # Next.js 15 Web 前端
│       ├── src/
│       │   ├── app/             # App Router 页面
│       │   │   ├── anime|movie/[pluginId]/[mediaId]/play/[chapterId]/
│       │   │   ├── manga|novel/[pluginId]/[mediaId]/read/[chapterId]/
│       │   │   ├── tracking/    # 我的追踪 + 收藏
│       │   │   ├── plugins/     # 插件市场（安装/启停/卸载/Kazumi 导入）
│       │   │   └── settings/    # 账号 / 数据 / 关于
│       │   ├── components/      # HeroBanner / CategoryTabs / ContentGrid /
│       │   │                    #   MediaCard / RankingSidebar / VideoPlayer /
│       │   │                    #   DanmakuLayer / AuthModal / UserMenu
│       │   ├── stores/          # Zustand: authStore / homeStore / syncStore
│       │   └── lib/             # 工具函数
│       │   └── lib/animations.ts # GSAP 动画统一封装（组件不再内联 gsap）
│       │       # 坑：gsap.from(...) 若带 delay 且 to 值隐式（不显式写 to），
│       │       #     immediateRender（默认 true）会在 delay 期间就把 from 值
│       │       #     写成内联样式，delay 结束后 GSAP 才捕获"当前值"当 to 目标，
│       │       #     结果把自己写的 from 值当成 to，动画变成原地不动、元素永久
│       │       #     隐藏。凡是 gsap.from + delay 组合都必须显式加
│       │       #     immediateRender:false（Hero 标题、详情页章节列表已修复）。
│       └── package.json
│
├── server/                      # Hono API（Node tsx 运行，兼容 Bun）
│   ├── src/
│   │   ├── routes/              # auth / sync（插件与弹幕路由目前在 index.ts）
│   │   ├── plugins/             # 插件引擎: manager / sandbox + mock 插件
│   │   ├── db/                  # Drizzle schema + migrations
│   │   └── index.ts             # 入口 + 插件/弹幕 API + mock 测试站点
│   ├── package.json
│   └── drizzle.config.ts        # Drizzle ORM
│
├── packages/                    # 共享包
│   ├── plugin-types/            # 插件类型定义 (TypeScript)
│   ├── plugin-adapter/          # Kazumi/Venera 规则适配器
│   └── theme/                   # 跨端共享主题令牌
│
├── docs/                        # 文档
├── docker-compose.yml           # PostgreSQL + Redis + MinIO
└── README.md
```

---

## 8. 开发路线图

### Phase 1 -- 核心骨架（MVP）

```
目标：跑通一个端到端的完整流程
```

| 周期   | 交付物                                                                          | 状态（2026-07-07）                                          |
| ------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| W1-2   | 项目脚手架：Monorepo (Turborepo) + Flutter App + Next.js + Hono Server + Docker | ✅ 完成                                                     |
| W3-4   | 插件引擎 v1：JS 沙箱 + 基础 CRUD 插件接口                                       | ✅ 完成（v2：WASM 沙箱 + cheerio 桥）                       |
| W5-6   | 动漫模块（Flutter）：搜索 → 详情 → 播放，复用 Kazumi 播放器经验                 | ✅ 完成                                                     |
| W7-8   | 影视模块：复用动漫播放器，适配影视源格式                                        | ✅ Web 端完成（含影视 mock 插件）；Flutter 沿用通用播放链路 |
| W9-10  | 漫画模块（Flutter）：阅读器（翻页/条漫），参考 Venera                           | ✅ 完成                                                     |
| W11-12 | 轻小说模块（Flutter）：阅读器 + 排版引擎                                        | ✅ 完成                                                     |
| W13-14 | Web 前端骨架：Next.js + GSAP 首页动画 + 动漫播放页                              | ✅ 完成（超出计划：含漫画/小说阅读页）                      |
| W15-16 | 用户系统 + 数据同步（追踪/收藏跨端同步）                                        | ✅ 基础版完成（注册/登录 + 进度同步）                       |

### Phase 2 -- 体验打磨

| 周期   | 交付物                                       | 状态（2026-07-07）                                         |
| ------ | -------------------------------------------- | ---------------------------------------------------------- |
| W17-18 | GSAP 全面落地：页面转场、卡片动画、弹幕系统  | ✅ 完成（动画统一封装在 lib/animations.ts）                |
| W19-20 | 插件市场：Web 端插件商店 + 安装/更新机制     | ✅ 完成（列表/安装/启停/卸载，写操作需登录）               |
| W21-22 | Kazumi/Venera 规则适配器（一键导入现有插件） | ✅ 基础版完成（XPath 选择器与 class 式 Venera 源暂不支持） |
| W23-24 | PWA 支持（Web 端离线缓存 + 安装到桌面）      | ✅ 完成（manifest + Service Worker，生产环境注册）         |

### Phase 3 -- 生态建设

| 周期   | 交付物                                  |
| ------ | --------------------------------------- |
| W25-26 | 社区插件审核机制 + 插件文档             |
| W27-28 | API 开放平台（第三方接入）              |
| W29+   | 持续迭代：推荐算法、社区功能、多语言... |

---

## 9. 可借鉴的开源项目

| 项目          | GitHub 地址                    | 借鉴点                                                                   |
| ------------- | ------------------------------ | ------------------------------------------------------------------------ |
| **Kazumi**    | github.com/Predidit/Kazumi     | 视频播放器、弹幕、JSON 规则引擎                                          |
| **Venera**    | github.com/venera-app/venera   | JS 插件引擎、漫画阅读器、本地文件管理                                    |
| **Mangayomi** | github.com/kodjodevf/mangayomi | 多内容类型聚合（动漫+漫画+小说）的先例                                   |
| **LNReader**  | github.com/LNReader/lnreader   | 轻小说阅读器 UI、章节解析逻辑                                            |
| **Readest**   | github.com/readest/readest     | 电子书/小说排版、沉浸式阅读器 UI (基于 Foliate 理念)、文本高亮与词典检索 |
| **movie-web** | github.com/movie-web/movie-web | Web 端影视搜索播放的 UX 参考                                             |
| **Stremio**   | github.com/Stremio/stremio     | 插件式架构、跨平台媒体中心的思路                                         |

---

## 10. 设计原则总结

### 来自 Ponytail

1. **YAGNI 先行** -- 每个模块先交付最小可用版本，不预设"未来可能需要"的抽象
2. **复用优先** -- Flutter 端复用 Kazumi 播放器、Venera 阅读器的成熟方案，不重写
3. **标准库/原生优先** -- Web 端能用 CSS 的就不用 GSAP，能用 View Transition API 的就不用手写
4. **单体起步** -- 不拆微服务，PostgreSQL + Redis 够用到用户量 10 万+

### 来自 GSAP

1. **性能优先** -- 大量元素动画用 `will-change: transform` + `force3D: true`
2. **渐进增强** -- GSAP 动画是锦上添花，核心交互不依赖动画
3. **移动端适配** -- 用 `matchMedia` 和 `ScrollTrigger.isTouch` 区分设备行为
4. **清理意识** -- 框架集成中用 `gsap.context()` 包裹，离开路由时 `revert()`

---

> 下一步：确认设计方向后，可以先搭建 Monorepo 骨架 + Flutter + Next.js + Bun 的项目脚手架，跑通基础路由。
