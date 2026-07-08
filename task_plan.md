# Titanhub 优化实施计划

此计划旨在逐项修复架构、安全性、数据库效率、前端性能和工程规范方面的问题。

## 实施阶段

| 阶段        | 任务说明                            | 目标文件                                                                                                                                                                                                                         | 状态   |
| :---------- | :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----- |
| **Phase 1** | 环境与基础设施补齐                  | [.gitignore](file:///F:/Titanhub/.gitignore), [.env.example](file:///F:/Titanhub/.env.example), [server/.env.example](file:///F:/Titanhub/server/.env.example)                                                                   | `todo` |
| **Phase 2** | 后端数据库性能与并发重构            | [sync.ts](file:///F:/Titanhub/server/src/routes/sync.ts), [danmaku.ts](file:///F:/Titanhub/server/src/routes/danmaku.ts), [db.ts](file:///F:/Titanhub/server/src/db/db.ts)                                                       | `todo` |
| **Phase 3** | QuickJS 沙箱安全（SSRF 过滤与缓存） | [sandbox.ts](file:///F:/Titanhub/server/src/plugins/sandbox.ts), [manager.ts](file:///F:/Titanhub/server/src/plugins/manager.ts)                                                                                                 | `todo` |
| **Phase 4** | 前端卡片 GSAP 性能优化与错误边界    | [MediaCard.tsx](file:///F:/Titanhub/apps/web/src/components/MediaCard.tsx), [homeStore.ts](file:///F:/Titanhub/apps/web/src/stores/homeStore.ts), [ContentGrid.tsx](file:///F:/Titanhub/apps/web/src/components/ContentGrid.tsx) | `todo` |
| **Phase 5** | 工程化与 CI 脚本补全                | [package.json](file:///F:/Titanhub/package.json), [server/package.json](file:///F:/Titanhub/server/package.json), [apps/web/package.json](file:///F:/Titanhub/apps/web/package.json)                                             | `todo` |

## 详细任务卡

### Phase 1: 基础设施及环境变量隔离

- [ ] 创建根 [\.gitignore](file:///F:/Titanhub/.gitignore)
- [ ] 物理删除 [apps/web/--full-page](file:///F:/Titanhub/apps/web/--full-page) 与 [server/src/db/db.json](file:///F:/Titanhub/server/src/db/db.json)
- [ ] 创建根 [\.env.example](file:///F:/Titanhub/.env.example) 与 [server/\.env.example](file:///F:/Titanhub/server/.env.example)
- [ ] 重构 [db.ts](file:///F:/Titanhub/server/src/db/db.ts), [drizzle.config.ts](file:///F:/Titanhub/server/drizzle.config.ts), [jwt.ts](file:///F:/Titanhub/server/src/auth/jwt.ts) 读取 `process.env.DATABASE_URL` 与 `process.env.TOKEN_SECRET`
- [ ] 更新 [docker-compose.yml](file:///F:/Titanhub/docker-compose.yml) 关联本地环境变量或标注默认凭证

### Phase 2: 后端数据交互与并发重构

- [ ] 重构 `POST /tracking`：使用 Drizzle 的 `onConflictDoUpdate` 批量同步，实现 LWW (Last-Write-Wins)
- [ ] 重构 `POST /favorites`：使用单一的 `delete` 和批量 `insert ... onConflictDoNothing` 缩减 N+1 SQL
- [ ] 重构 `GET /danmaku/...`：在 DB 事务中使用 PostgreSQL 的 `pg_advisory_xact_lock` 解决并发下的 Seed 数据竞争
- [ ] 引入 `pluginCache`（内存缓存）到 [db.ts](file:///F:/Titanhub/server/src/db/db.ts) 或 [manager.ts](file:///F:/Titanhub/server/src/plugins/manager.ts) 减少高频 DB 轮询

### Phase 3: 沙箱安全性 (SSRF 拦截)

- [ ] 在 [sandbox.ts](file:///F:/Titanhub/server/src/plugins/sandbox.ts) 注入的 `fetch` 包装中解析 URL，排除内网 IP 段、本地端口和 `/api/` 路由
- [ ] 仅保留对 `localhost:3001/mock-site/` 路径的明确白名单放行，保障内置的单元测试与 Mock Scraper 测试可用

### Phase 4: 前端交互优化与容错

- [ ] 重构 [MediaCard.tsx](file:///F:/Titanhub/apps/web/src/components/MediaCard.tsx)，将 `gsap.to` 鼠标倾斜特效改造为 `gsap.quickTo`
- [ ] 扩展 [homeStore.ts](file:///F:/Titanhub/apps/web/src/stores/homeStore.ts) 的 `HomeState` 以支持 `error` 状态，抛出具体的请求错误，不强行降级
- [ ] 在 [ContentGrid.tsx](file:///F:/Titanhub/apps/web/src/components/ContentGrid.tsx) 中增加容错层，展示错误提示及“重试”/“使用 Mock 降级”的控制逻辑

### Phase 5: 工程化提升与验证

- [ ] 在根目录 [package.json](file:///F:/Titanhub/package.json) 中添加 `format`、`typecheck` 等常用脚本
- [ ] 在 [server/package.json](file:///F:/Titanhub/server/package.json) 的 `build` 脚本中替换为实际的 `tsc --noEmit` 编译检查
- [ ] 运行 `pnpm run build` 进行 White-Box 验证，保证 TS 编译通过
