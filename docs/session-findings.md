# Titanhub 架构与代码深度分析报告

对用户反馈的批判性审查（Claw 评价）进行了逐项评估和代码走访，以下为详细的分析与改进方案规划。

---

## 1. 架构与运行环境问题

### 1.1 服务端插件代码直接存数据库与初始化冗余

- **现状分析**：
  - [db.json](file:///F:/Titanhub/server/src/db/db.json) 是开发残留物，包含了内置插件的静态代码。在实际运行中，系统通过 [index.ts](file:///F:/Titanhub/server/src/index.ts) 的 `seedMockPlugin` 将 [server/src/plugins/](file:///F:/Titanhub/server/src/plugins) 目录下的内置插件（如 [bangumi.js](file:///F:/Titanhub/server/src/plugins/bangumi.js) 等）在启动时读入并写入 PG 数据库。
  - 这种设计允许用户通过 API 动态安装和启用第三方插件（符合聚合平台设计初衷），但每次启动都强行覆写数据库，导致用户在数据库中做的修改被静默覆盖。而且，高频请求时每次都会执行 DB 查询以加载插件代码。
- **改进方案**：
  - 删除遗留的 [db.json](file:///F:/Titanhub/server/src/db/db.json)。
  - 在 [db.ts](file:///F:/Titanhub/server/src/db/db.ts) 或 [manager.ts](file:///F:/Titanhub/server/src/plugins/manager.ts) 中增加**内存缓存机制** (`pluginCache`)，减少对数据库的高频轮询。
  - 在 `savePlugin` 时支持版本号判定，防止启动时 builtin 插件强行覆盖高级版本或用户的动态修改。

### 1.2 Bun 与 Node.js 双运行时策略

- **现状分析**：
  - 经过测试，在 Windows 开发环境下，全局未安装或未配置 `bun` 环境变量，导致 `bun --version` 报错。这证明了支持 Node.js (使用 `tsx` 运行) 作为 fallback 是必要的，否则纯 Bun 项目在非 Bun 环境下无法启动。
- **改进方案**：
  - 保留 Node.js 与 Bun 的双运行时兼容，但在 [index.ts](file:///F:/Titanhub/server/src/index.ts) 底部和 [package.json](file:///F:/Titanhub/server/package.json) 中添加注释文档说明此策略（Bun 为首选，Node.js + tsx 为兼容 fallback）。
  - 修改 [server/package.json](file:///F:/Titanhub/server/package.json) 的 `build` 脚本，将占位符 `echo` 替换为 TypeScript 类型检查脚本（如 `tsc --noEmit`），作为 white-box 测试保障。

### 1.3 QuickJS 沙箱重复创建与 SSRF 风险

- **现状分析**：
  - [sandbox.ts](file:///F:/Titanhub/server/src/plugins/sandbox.ts) 中，注入沙箱的 `fetch` 函数直接调用了主机的 `fetch`，存在严重的内网 SSRF 风险（插件代码可扫描内网、请求本地管理接口）。
  - 每次执行插件方法都创建 QuickJS 上下文是由于 QuickJS 并非线程/并发安全。虽然 `getQuickJS()` 已经是单例 Promise（WASM 仅加载一次），但每次 eval 全量插件代码仍有开销。
- **改进方案**：
  - **SSRF 拦截**：在 [sandbox.ts](file:///F:/Titanhub/server/src/plugins/sandbox.ts) 注入的 `fetch` 中，对传入 of URL 进行合法性检查，禁止访问本地 IP（如 `127.0.0.1`, `localhost`）、私有网段（`10.0.0.0/8`, `192.168.0.0/16` 等），但特定白名单的测试 Mock 接口例外（如 `http://localhost:3001/mock-site/`）。
  - **代码内存缓存**：引入 1.1 的内存缓存以避免重复查询 DB。

---

## 2. 后端质量与安全性问题

### 2.1 硬编码凭证与缺少 .env 文件

- **现状分析**：
  - 数据库密码 `password123` 在 [docker-compose.yml](file:///F:/Titanhub/docker-compose.yml)、[db.ts](file:///F:/Titanhub/server/src/db/db.ts) 以及 [drizzle.config.ts](file:///F:/Titanhub/server/drizzle.config.ts) 中硬编码。
  - JWT Secret 在 [jwt.ts](file:///F:/Titanhub/server/src/auth/jwt.ts) 中硬编码为 `titanhub-dev-secret-change-me`。
- **改进方案**：
  - 在根目录下创建 [.env.example](file:///F:/Titanhub/.env.example) 和 [server/.env.example](file:///F:/Titanhub/server/.env.example)。
  - 将硬编码密码移至环境变量 `DATABASE_URL`、`JWT_SECRET`、`MINIO_ROOT_PASSWORD`。
  - 编写 [.gitignore](file:///F:/Titanhub/.gitignore) 确保 `.env` 不会被提交。

### 2.2 缺失 .gitignore 文件

- **现状分析**：
  - 根目录下没有 [.gitignore](file:///F:/Titanhub/.gitignore)，导致构建产物、依赖目录及测试残留（如 `apps/web/--full-page`）存在被提交的风险。
- **改进方案**：
  - 创建根 [.gitignore](file:///F:/Titanhub/.gitignore) 并过滤 node_modules、.next、.turbo、dist、.env、tsbuildinfo 以及 `apps/web/--full-page`。
  - 物理删除 [apps/web/--full-page](file:///F:/Titanhub/apps/web/--full-page)。

### 2.3 数据库同步接口与弹幕 Seed 并发数据竞争

- **现状分析**：
  - [sync.ts](file:///F:/Titanhub/server/src/routes/sync.ts) 的 `POST /tracking` 和 `POST /favorites` 接口中存在显式的 N+1 查询问题。
  - [danmaku.ts](file:///F:/Titanhub/server/src/routes/danmaku.ts) 的 `GET /danmaku/...` 接口在未查询到弹幕时自动 seed 数据。但在并发请求下存在严重的竞争问题，会导致重复写入多份 Seed 弹幕。
- **改进方案**：
  - **Sync 优化**：使用 Drizzle 的 `onConflictDoUpdate` 批量处理 `POST /tracking`（利用 LWW 时间戳过滤）；使用 `onConflictDoNothing` 和 `inArray` 批量处理 `POST /favorites` 的增删。
  - **弹幕并发锁**：使用 PostgreSQL 的行锁或事务级咨询锁 `pg_advisory_xact_lock` 确保并发请求下只有一个请求能触发 Seed 逻辑。

---

## 3. 前端质量与性能问题

### 3.1 每张卡片独立运行 GSAP Hover

- **现状分析**：
  - 在 [MediaCard.tsx](file:///F:/Titanhub/apps/web/src/components/MediaCard.tsx) 中，每一次鼠标 `onMouseMove` 都会重新调用 `gsap.to`，在高频鼠标移动下会创建极多 tween 对象，造成 GC 压力。
- **改进方案**：
  - 在 [MediaCard.tsx](file:///F:/Titanhub/apps/web/src/components/MediaCard.tsx) 中引入 `gsap.quickTo`，提前创建插值属性更新函数，不仅提升效率还能彻底避免 tween 重建。

### 3.2 错误边界与 Loading 状态管理

- **现状分析**：
  - [homeStore.ts](file:///F:/Titanhub/apps/web/src/stores/homeStore.ts) 获取失败后静默降级为 Mock 数据，用户无感知。
  - 页面缺少重试和错误展示面板。
- **改进方案**：
  - 为 `HomeState` 增加 `error` 状态，捕获 API 请求异常，不在 catch 中直接降级。
  - 在 [ContentGrid.tsx](file:///F:/Titanhub/apps/web/src/components/ContentGrid.tsx) 中判断 error 状态，展示一个优雅的错误组件，提供“重试 (Retry)”与“加载演示降级数据 (Load Demo Data)”选项。

---

## 4. 其它工程化与工程边界问题

- **Flutter 状态**：移动端目前属于原型骨架阶段，后续迭代会深入重用 Kazumi/Venera 方案。
- **构建脚本补充**：在根 [package.json](file:///F:/Titanhub/package.json) 中补全常用快捷开发指令（如 `test`、`format`、`typecheck` 等）。
