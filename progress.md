# 进度跟踪日志

## 2026-07-17 会话：启动双轨运行优化
* 初始化任务规划文件。
* 在 `apps/mobile/pubspec.yaml` 中添加 `flutter_js` (JS 引擎) 和 `html` (HTML 解析) 依赖并成功拉取。
* 创建了 `apps/mobile/lib/core/sandbox/js_engine.dart` 并完整实现 Dart 侧与 JS 沙箱的 `fetch` 接口以及 Cheerio HTML 规则解析器（`select`, `selectOne`, `selectText`, `selectAttribute`）。
* 将全部的插件 JS 文件作为本地资产打包进 App 并在 `pubspec.yaml` 中声明，实现了 `local_plugin_runner.dart`。
* 重构了 `media_providers.dart` 中全部 8 个 FutureProvider，实现了自动识别本地插件与服务器下线时的无缝本地沙箱降级回退。
* 编写了根目录 `Dockerfile`，实现了全自动的 Hono 服务端多包依赖打包，并重构了 `docker-compose.yml`，现在可以通过单一指令 `docker compose up -d` 部署包含 PostgreSQL 数据库在内的完整后端公网环境。
