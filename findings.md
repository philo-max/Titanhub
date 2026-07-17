# 研究发现与技术要点

## 当前移动端现状
* 宿主包名已重构为 `titanhub`，默认显示名称调整为 `Titanhub`，且已具备 logo 图标。
* 客户端使用 Riverpod 做状态管理，Drift SQLite 存储数据，Dio 发送网络请求。
* 目前的 plugin 规则是 JS 脚本，在服务器端是用 `quickjs-emscripten` 库运行的。
