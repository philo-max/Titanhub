# Titanhub 本地优先与 WebDAV 实施计划

> For agentic workers: 使用已安装的 `subagent-driven-development` 或 `executing-plans` 按工单执行；先读取对应 SKILL.md。Claude CLI 已完成鉴权、SQLite 迁移及桌面会话后触发额度上限；内部代理接续前端、阅读恢复和 WebDAV，agy 提供安装包/CI/README 补丁及最终进度审查，Codex 负责整合、评审与验收。

**Goal:** 交付可安装卸载的 Windows 客户端，无需注册即可在本机保存并恢复收藏与进度，再通过用户自己的 WebDAV 手动同步桌面和手机。

**Architecture:** 桌面每次启动创建本地能力会话，沿用 Hono 与 SQLite 数据访问；同步按统一记录协议做版本合并，每设备发布独立快照。P2 已验证独立 Dart 协议，写入 Drift 及移动 WebDAV 仍待实施。

**Tech Stack:** 现有 Electron、Next.js/React/Zustand、Hono/sql.js、Flutter/Drift/Dio；新增依赖必须逐项证明必要。

设计依据：[最小设计](../specs/2026-10-23-local-first-webdav-design.md)。当前状态：P0 与 Windows P1 已实现并完成受控夹具的打包程序 GUI 验收，P-PACK 的 NSIS 安装包已全量重建；实际安装生命周期和真实 NAS 兼容性仍待验收，P2 完成独立协议验证，手机互通尚未接入。

## 当前交付与验收状态（2026-10-24）

| 阶段 | 已实现或已有证据 | 尚未完成 |
| --- | --- | --- |
| P0 | 本地免注册、媒体复合键、退出捕获与落盘、来源安装启停卸载；真实 GUI 验证收藏及四类位置重启恢复 | 实际互联网内容源可用性需单独核验 |
| P1 | Windows 手动 WebDAV、快照合并与故障恢复、SQLite v4、safeStorage、设置 UI；双隔离资料目录实际 GUI 同步通过 | 真实 NAS 服务兼容性尚未验证 |
| P-PACK | 用户用短 TEMP 从 1.0.0 升到 1.0.1 并确认启动；1.0.2 内置短目录/环境恢复，10 项真实 NSIS 夹具与 desktop 51 项通过，安装包已构建 | 1.0.2 真实 UAC 升级、干净 Windows 生命周期及卸载重装保留资料仍待实机验证 |
| P2 | Dart 与 TS 共用 96 组向量通过；Dart 6 项容量边界及 analyze 通过 | Drift 迁移、移动传输/凭据/设置及桌面手机互通尚未接入 |

经理最终独立执行 server 92 项、web 45 项、desktop 39 项，共 176 项测试全部通过（含真实 packaged 烟测）；类型检查、Lint 与全量安装包构建通过。GUI 内容与 WebDAV 服务使用受控夹具，实际本地存储与桌面链路未替换。以下未勾选项仍需对应证据，不因阶段实现完成而自动视为验收通过；工单 Owner 为原始分工，实际接续见本节。

## 执行纪律

- 当前实现分支 `codex/windows-local-first`，原设计分支为 `codex/local-first-webdav-design`。已获取差异快照并保留全部既有未提交改动。
- 每次只派一张涉及共享状态的实现工单；agy 不与 Claude 同时修改同一文件。首张工单不混入 WebDAV、数据库迁移或界面重做。
- 先写能复现缺口的测试，确认失败，再做最小修改并验证。执行时不得新增代码注释，遵循项目既有格式。
- 只提交自己明确核对的文件；本计划不授权自动提交、推送、发布或清理现有数据。
- 文件清单是计划边界；若必须扩展，先说明原因并核对是否已获授权，不能顺手重构。

## 工单 P0-A：桌面本地能力会话

**Owner:** Claude；**Reviewer:** Codex；**依赖:** 无。
**首单范围:** 免注册建立 local 会话并通过现有受保护接口完成本地读写；不承诺恢复播放器位置。

**修改：** `apps/desktop/src/main/server-manager.ts`、`main/index.ts`、`preload/index.ts`；`server/src/auth/jwt.ts`、`server/src/index.ts`；`apps/web/src/stores/authStore.ts`、`app/layout.tsx`。外部子进程环境筛选限定在已定位的 `server/src/plugins/sniffer.ts` 浏览器启动处。
**新增：** `server/src/auth/local-session.ts`、`local-session.test.ts`；`apps/web/src/components/LocalDataBootstrap.tsx`、`apps/web/src/lib/local-session.ts` 及对应会话测试。
**扩展现有测试：** `apps/desktop/src/main/server-manager.test.ts`、`packaged-smoke.test.ts`；新增 `main/local-session.test.ts` 检查 IPC 调用来源。

- [ ] 写测试：有效本地能力 -> local 身份；无/错令牌 -> 401；仅 SQLite 开关不能授权；非桌面不接受本地令牌。
- [ ] 写测试：非应用窗口、子 frame、来源不符的 session:local 被拒；页面无法获得签名密钥。
- [ ] 运行新测试确认失败，记录实际失败原因。
- [x] 主进程生成随机令牌并仅注入后端环境；后端校验桌面配置、loopback 绑定及能力；令牌比较避免长度异常。
- [ ] 复用单实例锁并确认失锁立即退出；验证当前后端的挑战响应后才交付 apiBase，检查实际监听地址，避免向占用端口的其他服务发送能力。
- [ ] 桌面模式拒收云端 JWT；外部浏览器子进程移除本地能力及敏感凭据环境变量，公共媒体读取不增加 URL 令牌。
- [x] 增加受限 preload 本地会话读取；仅向当前真实后端地址发送令牌，不存 localStorage、不覆盖已有云端身份。
- [x] bootstrap 使用内存模式，初始化/重试状态明确；根布局仍保持服务端组件，通过独立客户端组件接入。
- [ ] 通过公共 Hono 路由请求保存一条进度，关闭并重开临时 SQLite，再读回；携带前一轮能力访问新后端须失败。
- [ ] 在开发与打包后端分别验证，不依赖 cmd/npx 的后端 IPC 透传。
- [ ] 运行本单相关测试、server/web/desktop 类型检查与 Lint，确认云端正常/异常认证回归。

**完成标准：** 无用户注册、无 PostgreSQL 运行时依赖；能力会话可受保护地访问本地数据，错误能力不可访问，云端 JWT 路线不变。

## 工单 P0-B：本地数据与操作入口

**Owner:** Claude；**依赖:** P0-A。
**修改：** `server/src/db/sqlite/migrations.ts`、`index.ts`；`server/src/routes/sync.ts`、`history.ts`；`apps/web/src/stores/syncStore.ts`、`components/UserMenu.tsx`、`app/tracking/page.tsx`、`app/settings/page.tsx`。
**退出写入确认：** `apps/desktop/src/main/index.ts`、`main/server-manager.ts`、`preload/index.ts`，复用前单会话边界。
**测试：** 扩展 `server/src/db/sqlite.test.ts`；新增 `server/src/routes/local-data.test.ts`、`apps/web/src/stores/syncStore.test.ts`。

- [ ] 写旧版数据库迁移回归：两种主体、已有收藏/进度/历史均保留，重跑迁移幂等；相同 mediaId 的不同来源可共存。
- [ ] 写状态测试：免注册收藏增删、失败有反馈、加载失败不覆盖为成功空列表、较旧响应不能抹掉较新本地编辑。
- [x] 新增 SQLite 迁移：tracking/favorites 唯一键加入 media_type、plugin_id；history 同时保留 chapter_id。
- [ ] 用事务复制并校验旧数据后切换，保留旧表或可恢复备份；不修改已发布迁移，不自动合并旧 user_id 到 local。
- [x] SQLite 查询、路由和前端判重统一完整媒体三字段；云端数据库结构不在本单迁移范围。
- [x] syncStore 使用有效的本地会话或原有云会话，检查非 2xx 和业务失败；成功反馈以实际写盘结果为准。
- [x] 正常退出先 flush 本地写入并等待确认，再停止后端；失败给出重试/明确放弃入口，不等待 WebDAV。强制杀进程只验收已确认的数据。
- [x] 桌面追踪与设置入口免注册可见，保留浏览器账号入口；本地数据加载不依赖网络元数据成功。
- [x] 清缓存操作不得清空 SQLite 资料、设备标识或 WebDAV 凭据；调整本地模式文案。
- [ ] 公共接口黑盒验证收藏增删、重启恢复、来源隔离；补充对应 UI 操作证据。

## 工单 P0-C：实际恢复播放和阅读位置

**Owner:** Claude；**依赖:** P0-B。
**修改：** `apps/web/src/components/VideoPlayer.tsx`；`app/anime/[pluginId]/[mediaId]/play/[chapterId]/page.tsx`、`app/movie/[pluginId]/[mediaId]/play/[chapterId]/page.tsx`、`app/manga/[pluginId]/[mediaId]/read/[chapterId]/page.tsx`、`app/novel/[pluginId]/[mediaId]/read/[chapterId]/page.tsx`。
**新增测试辅助：** `apps/web/src/lib/resume-position.ts`、`resume-position.test.ts`；仅当多页面确有复用时提取计算函数。

- [ ] 先测视频位置边界、漫画第一页/末页、小说比例、空章节/未加载时长、无效数值和旧记录兼容。
- [x] 加入可选初始位置，等待对应章节数据和媒体就绪后只恢复一次；保持播放器动态加载与 source.load() 现有规则。
- [x] 视频使用有效秒数并限幅，旧记录回退到 ratio；漫画旧 ratio 按现有 `(pageIndex+1)/pageCount` 还原，避免错一页。
- [x] 小说等待正文布局就绪再恢复；初始化恢复前阻止零进度写回，切换章节不复用上一章位置。
- [ ] 用本地受控媒体/阅读夹具验证保存、退出、重启、继续；主动重看后重启应保留较新的回退位置。

## 工单 P1-A：统一快照与确定性合并

**Owner:** Claude；**依赖:** P0-B，P0-C 可独立完成后再进入完整验收。
**新增：** `server/src/sync/protocol.ts`、`protocol.test.ts`、`storage.ts`、`storage.test.ts`；`docs/superpowers/specs/fixtures/webdav-v1.json`。
**修改：** `server/src/db/sqlite/migrations.ts`、`index.ts`，仅补充本地同步元数据及同事务更新。

- [ ] 固定线格式与黄金向量：媒体复合 key、收藏墓碑、完整进度、记录 counter/deviceId、设备 generation；数值和字段大小限制明确。
- [ ] 先测交换律、结合律、幂等、乱序、重复记录、同版本异内容、删除/重加、重看、时钟偏差和未知 schema。
- [ ] JSON 键顺序、空白和数字表现不同但规范字段相同应判等；key 不做 Unicode 归一化，两种语言用相同测试向量。
- [ ] 新迁移添加设备状态、版本与待发布内容；旧数据在首次导出前一次性赋版本，并持久化迁移完成状态。
- [ ] 编辑与版本递增同事务，导入不换版本；收到远端大 counter 后下一本地编辑必须更大。
- [ ] 导出只包含允许字段；生成新设备身份时不复制旧 deviceId，不同步 user_id、token、Cookie、密码或私有配置。
- [ ] 所有输入验证完成后才进入合并事务；失败不覆盖原数据、待发布版本或删除墓碑。

## 工单 P1-B：桌面手动 WebDAV

**Owner:** Claude；**依赖:** P1-A，完整交付需 P0-C。
**新增：** `server/src/sync/webdav.ts`、`webdav.test.ts`、`coordinator.ts`、`coordinator.test.ts`；`apps/desktop/src/main/webdav.ts`、`webdav.test.ts`。
**修改：** `apps/desktop/src/main/server-manager.ts`、`main/index.ts`、`preload/index.ts`；`server/src/index.ts`；`apps/web/src/app/settings/page.tsx`。

- [ ] 先写开发/打包双向 IPC 集成测试；确认凭据能通过受控主进程交给正确子进程，回包超时和子进程退出有反馈。
- [ ] 若现有开发启动链不透传 IPC，在本单明确修正启动入口并测试；不得临时暴露无凭据的 HTTP 控制接口。
- [ ] 增加 safeStorage 凭据保存/清除、脱敏配置读取和经过发送者校验的测试连接/同步操作；仅使用 Electron 当前版本可用 API。
- [ ] 可控 WebDAV 夹具实现 PROPFIND/MKCOL/GET/PUT/MOVE/DELETE，并注入 401、403、404、507、超时、半包和不支持方法。
- [ ] 按设计实现每设备不可变世代、待发布快照持久化、MOVE 后内容确认；模拟每个中断点后重启恢复。
- [ ] 实测 Overwrite:F、GET 404 后重列举、准确字节重试及遗留临时文件清理；坏文件提示设备/路径，禁止自动排除后继续上传。
- [ ] 两个隔离资料目录并发编辑，完整同步多轮，验证一致结果和不相关条目保留；异常远端不得跳过后继续上传。
- [ ] 处理同步中本地编辑、首次非空远端、删除墓碑、路径转义、跨源重定向、错误 XML/响应限额；避免通用代理能力。
- [ ] 在现有设置页提供配置、测试连接、立即同步、最近成功时间、待同步/错误状态；默认关闭。
- [ ] 至少选定一个真实 WebDAV 服务的独立测试目录，验证能力、权限、MOVE、失败反馈和内容确认后再标记兼容。

## 工单 P2：Flutter 对齐与桌面手机互通

**Owner:** Claude；**依赖:** P1 协议与桌面流程验收。
**修改：** `apps/mobile/lib/core/storage/app_database.dart`、`features/tracking/sync_provider.dart`、`pubspec.yaml`；生成文件仅由 build_runner 更新。
**已新增：** `apps/mobile/lib/core/sync/sync_protocol.dart`、`apps/mobile/test/core/sync/sync_protocol_test.dart`、`apps/mobile/tool/check_sync_protocol.dart`、`docs/fixtures/sync/protocol-v1-vectors.json`、`server/src/sync/cross-platform.test.ts`。
**后续新增：** `webdav_sync.dart`、`webdav_sync_test.dart`。

- [x] 用桌面同一组 JSON 黄金向量先写测试，再实现计数、字符串比较、墓碑和校验；独立 Dart 与 TS 的 96 组向量通过，Dart 另过 6 项容量边界。Flutter 测试文件已写但尚未通过 Flutter runner 运行。
- [ ] Drift 迁移完整媒体标识、版本及设备状态，保留旧收藏进度；手机收藏同样先落盘，不依赖 authTokenProvider。
- [ ] 评估并验证安全存储依赖；使用现有 Dio 发 WebDAV 请求，不在 shared preferences 或普通数据库明文存密码。
- [ ] 完成设置入口后实测桌面->手机、手机->桌面，包含重看、删除、离线冲突与新安装设备。

## 工单 P-PACK：Windows NSIS 安装包与交付流水线

**Owner:** Claude；**Reviewer:** Codex；**QA:** agy 整理安装验收证据。
**依赖:** 安装包骨架可先于 P1 打通；正式发布须通过 P0 和本次纳入的同步功能验收。
**修改：** `apps/desktop/package.json`、根 `package.json`、`.github/workflows/release.yml`、`README.md`；完善现有打包烟测，具体新增测试文件在实施前限定。

- [x] 保留现有 dir 构建供内部烟测，新增明确的 `package:installer` 调用 NSIS；根正式桌面打包命令产出安装 EXE，另保留明确的 dir 命令。
- [x] 使用安装向导模式、允许选择目录、当前用户安装、桌面/开始菜单快捷方式；明确产物名 `Titanhub-Setup-${version}-${arch}.exe`。
- [ ] 复用 `apps/web/public/logo.png` 或移动端现有 Titanhub 标识生成 Windows 图标资源，并验证安装包、应用和快捷方式显示一致；不重新设计品牌。
- [ ] 明确保留 appId、产品名和 userData 路径；默认卸载保留资料，不增加自动更新或隐式清数据行为。
- [ ] 根脚本先构建 server/web/desktop，再调用安装打包；核对 server/dist、Next standalone/static、WASM、插件及 Electron 运行时资源完整。
- [x] 独立新增 Windows Electron CI job，准备 Node/pnpm、构建并上传安装 EXE；保留并区分现有 Flutter Windows ZIP 任务，避免同名覆盖或冒充安装包。
- [ ] 调整 release 下载/依赖列表以纳入 Electron 安装产物；本轮不触发公开发布。版本号与产物版本来自同一来源。
- [ ] README 给普通用户安装步骤；开发者命令放开发部分，安装用户无需启动后端或数据库。
- [ ] 在干净 Windows 测试环境安装到含空格/中文路径，以普通用户启动并验证内置后端和本地持久化。
- [ ] 用前后两个测试版本验证覆盖升级，再验证卸载/重装、快捷方式、进程退出和原资料恢复；仅操作专用测试资料，不碰真实用户安装。
- [ ] 记录安装 EXE 路径、版本、SHA256、构建结果和手工验收结果，不能用 win-unpacked 烟测替代实际安装验收。

## 验收矩阵（agy 初稿，Codex 修订）

以下为完整验收标准。自动化和部分真实 GUI 证据见顶部状态；未逐项记录完整证据的用例继续保留待验收，尤其 TC13-TC17 不得视为通过。

| 编号 | 阶段 | 操作 | 通过标准 |
| --- | --- | --- | --- |
| TC01 | P0 | 无账号断网收藏、取消及更新进度，关闭重开 | 本地变更保留；网络资源加载失败不阻断数据读取 |
| TC02 | P0 | 同 mediaId、不同类型或来源分别操作 | 三字段隔离；标题相同也不自动合并 |
| TC03 | P0 | 正常观看后主动退回重看，关闭重开 | 恢复最新有效位置；初始化不覆盖成零 |
| TC04 | P0 | 占用原 Web/后端端口后重启 | 新端口仍获本地会话并读取同一资料；不要求重新登录 |
| TC05 | P0 | 无/错误能力、伪造 frame、云端发送本地能力 | 被拒绝；合法本地会话与云端 JWT 各按其模式工作 |
| TC06 | P1 | 空设备首次同步已有远端；随后关闭 WebDAV | 先读取并合并；关闭后本地继续使用且不删除远端 |
| TC07 | P1 | A 删除收藏，B 持有旧数据再同步 | 旧版本不复活；明确重新收藏的新版本可生效 |
| TC08 | P1 | 上传中本地再编辑；超时或崩溃后重试 | 新编辑保留，已提交快照不被不同内容复用 |
| TC09 | P1 | 最高世代损坏、未知 schema、同版本异内容 | 本次停止，不写本地合并、不上传、不清理有效远端 |
| TC10 | P1 | 错密码、只读、空间满、断网、不支持 MOVE | 分别反馈并允许修正重试；不显示伪成功 |
| TC11 | P1 | 两个独立桌面资料离线修改后反复完整同步 | 按协议确定性收敛；保留不冲突数据；不承诺冲突双方均获胜 |
| TC12 | P1 | 检查日志、URL、导出文件和设置读取结果 | 不包含密码、认证头、会话能力或签名密钥 |
| TC13 | P2 | 桌面手机双向修改、换设备、重看和删除 | 同一黄金向量及用户数据得到相同结果 |
| TC14 | P-PACK | 干净 Windows 普通用户安装并启动 | 无 Node/Postgres/开发命令前置要求，安装版内置服务可用 |
| TC15 | P-PACK | 安装目录包含中文或空格，通过桌面/开始菜单启动 | 资源路径正确，两个快捷方式均指向已安装客户端 |
| TC16 | P-PACK | 安装版创建本地资料，再覆盖安装新测试版本 | 版本更新，SQLite 与 WebDAV 配置/设备身份保留 |
| TC17 | P-PACK | 正常退出、卸载、重装后再打开 | 无残留后台进程；程序可卸载，默认资料保留并可恢复 |
| TC18 | P-PACK | 核对 GitHub 安装 EXE、元信息与构建来源 | 文件名/版本/架构一致，能区分 Flutter ZIP 与 Electron 安装包 |

## 验证命令与交付记录

- 逐单优先执行新测试文件：`pnpm --filter titanhub-server exec vitest run <文件>`、`pnpm --filter titanhub-web exec vitest run <文件>`。
- 桌面回归：`pnpm --filter titanhub-desktop test`；打包烟测要求先有对应产物，必须确认测试启动的是本次构建。
- 类型检查分别在 server/web/desktop 执行 `pnpm --filter <包名> exec tsc --noEmit`；构建验证另行执行各包 build。
- Lint：分别执行 `pnpm --filter titanhub-server lint`、`pnpm --filter titanhub-web lint`、`pnpm --filter titanhub-desktop lint`。
- P2：在 `apps/mobile` 执行 `flutter test`、`flutter analyze`；涉及 Drift 生成时执行现有 build_runner 流程并复核差异。
- P2 纯协议可独立验证：在仓库根目录执行 `dart apps/mobile/tool/check_sync_protocol.dart`，无需 Flutter 依赖或 pub get；这不能代替完整 Flutter 应用编译和手机互通验收。
- 每单记录命令、退出码、失败项及黑盒操作结果；mock WebDAV 通过不等于真实服务商兼容通过。
- TC06-TC13 的远端部分先用本地夹具验证；真实服务手工验收需要独立目录与授权凭据，凭据不得写进计划或报告。
- 历史设计阶段记录：当时仅核对设计文件，10 个桌面测试属于旧基线。实施后的验证以顶部当前状态和最新执行结果为准，不能沿用旧基线代替本功能验收。
