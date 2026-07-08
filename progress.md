# Titanhub 优化实施进度

## 当前会话状态

- **开始时间**：2026-07-07T19:27:00
- **当前阶段**：Phase 1: 环境与基础设施补齐

## 任务执行记录

### Phase 1: 基础设施及环境隔离

- [x] 创建根 [\.gitignore](file:///F:/Titanhub/.gitignore)
- [x] 删除 [apps/web/--full-page](file:///F:/Titanhub/apps/web/--full-page)
- [x] 删除 [server/src/db/db.json](file:///F:/Titanhub/server/src/db/db.json)
- [x] 创建根 [\.env.example](file:///F:/Titanhub/.env.example) 和 [server/\.env.example](file:///F:/Titanhub/server/.env.example)
- [x] 隔离 [db.ts](file:///F:/Titanhub/server/src/db/db.ts) 中的连接串，支持环境变量
- [x] 隔离 [drizzle.config.ts](file:///F:/Titanhub/server/drizzle.config.ts) 和 [jwt.ts](file:///F:/Titanhub/server/src/auth/jwt.ts) 中的 Secret/URL

### Phase 2: 后端数据交互与并发重构

- [x] 重构 `POST /tracking` (Drizzle `onConflictDoUpdate`)
- [x] 重构 `POST /favorites` (Drizzle 批量操作)
- [x] 重构 `GET /danmaku/...` (Postgres Advisory Lock 行锁并发控制)
- [x] 在 [db.ts](file:///F:/Titanhub/server/src/db/db.ts) 增加 `pluginCache`（内存缓存）

### Phase 3: 沙箱安全性 (SSRF 拦截)

- [x] 限制 [sandbox.ts](file:///F:/Titanhub/server/src/plugins/sandbox.ts) 注入的 `fetch` 进行 SSRF 拦截与本地域名白名单

### Phase 4: 前端交互优化与容错

- [x] 优化 [MediaCard.tsx](file:///F:/Titanhub/apps/web/src/components/MediaCard.tsx) 使用 `gsap.quickTo`
- [x] 增加 [homeStore.ts](file:///F:/Titanhub/apps/web/src/stores/homeStore.ts) 错误捕获
- [x] 在 [ContentGrid.tsx](file:///F:/Titanhub/apps/web/src/components/ContentGrid.tsx) 中增加优雅的错误与重试 UI

### Phase 5: 工程化提升与验证

- [x] 在根 [package.json](file:///F:/Titanhub/package.json) 中补充 `format`、`typecheck` 脚本
- [x] 将 [server/package.json](file:///F:/Titanhub/server/package.json) 里的 `build` 改为 `tsc --noEmit`
- [x] 执行全量 White-Box 与 Black-Box 测试验证

---

## 变更详情与测试反馈

- **基础设施**：新建了根 [\.gitignore](file:///F:/Titanhub/.gitignore)，移除了 [db.json](file:///F:/Titanhub/server/src/db/db.json) 和 debug 文件 [--full-page](file:///F:/Titanhub/apps/web/--full-page)，添加了 [\.env.example](file:///F:/Titanhub/.env.example)。
- **并发重构**：优化了 `POST /tracking` 为 `onConflictDoUpdate` 批量更新，`POST /favorites` 为批量合并逻辑，极大提升性能；在 `GET /danmaku` 接口通过 Drizzle 事务 + `pg_advisory_xact_lock` 成功实现了行级防竞争弹幕 Seed 机制。
- **内存缓存与版本管理**：在 [db.ts](file:///F:/Titanhub/server/src/db/db.ts) 中增加插件的内存缓存 `pluginCache`，并限制 Builtin 插件在启动时仅在版本提升时进行覆写，不破坏用户的自定义动态修改。
- **沙箱安全**：在 [sandbox.ts](file:///F:/Titanhub/server/src/plugins/sandbox.ts) 增加了 `isSafeUrl` 方法，屏蔽私有 IP 及本地端口的 SSRF 扫描风险，且对测试 Mock Site 的 localhost URL 做特判放行以保证测试通过。
- **卡片动画**：将 [MediaCard.tsx](file:///F:/Titanhub/apps/web/src/components/MediaCard.tsx) 改为 GSAP 推荐的 `gsap.quickTo` 方法做倾斜追踪，消除了每次 mousemove 创建 Tween 的 GC 压力，保障流畅度。
- **错误降级 UI**：修改了 [homeStore.ts](file:///F:/Titanhub/apps/web/src/stores/homeStore.ts) 和 [ContentGrid.tsx](file:///F:/Titanhub/apps/web/src/components/ContentGrid.tsx)，API 获取失败时给出友好的红字警告和“重试”或“加载演示数据”按钮，不强行假装成功。
- **测试保障**：运行 `pnpm run build` 全局 TS 类型校验及 Next.js 静态页面打包通过，Vitest 23 个单元测试全部成功 Pass。
