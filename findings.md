# 研究发现与技术要点

## 2026-11-01 漫画与双端验证

- 实际桌面资料库副本包含93个来源。原库未写入（3682304字节、mtime仍2026-10-31 23:31:46）。现有venera-Komiic通过当前兼容层真实返回20项；venera-baozi明确HOME_UNSUPPORTED，应提示不支持首页。plugins.id是内部UUID，真正来源身份取identifier，内置MangaDex仍为mangadex，与手机一致。
- 桌面漫画卡片复用SmartImage后封面恢复；外链/0页章节应在语言fallback判空前过滤；浏览器旧404缓存影响直接图重试，来源UA描述符接入既有受控传输后中文第1话前4图已出图。
- 移动Dart实际存储/同步代码接收桌面GUI进度，再写零基position7回传。桌面GUI点击继续阅读已定位并显示第8图。不是本轮手机硬件GUI同步验收。
- Android16/16KB七色番搜索/柯南两线280与1265/分段通过；原生播放器打开失败。相同Android HttpsURLConnection Range GET返回206/1024字节，不能称来源完全不可达。临时mpv日志显示TCP建立后5.35秒读取超时（ffurl_read -110），本机media_kit源码默认network-timeout=5；正按20秒有界等待修复并复验，不修改TLS/DNS/代理。

## Android动漫播放初查（2026-10-31）

- 主管实网HTTPS获取7sefun柯南TV详情/voddetail/27146.html：1544链接，线路1=279、线路2=1265。线路1配置指向另一公开播放页；线路2player_aaaa encrypt2解码为真实mp4入口。对入口普通Range GET得到206/1024字节（未下载整集）；HEAD在签名CDN403不能当GET失败，仍以真机出画时间推进为最终判据。
- 已批准的原Android spec含真实播放链路，本轮按该架构推进而非重复申请同一范围；新方案落实为来源CSS适配+可取消WebView解析+原生播放器请求头/分线选集。桌面lineId/lineName字段需兼容到手机group字段，保留同一来源/章节ID。

- 手机只注册Bangumi资料与MangaDex；VideoSource只有quality/url，没有headers，Chapter只有id/title/chapterNo，没有线路；不能直接接桌面多线路返回形状。
- 桌面bundled dilidili/ssrfun/cyfz仍含占位详情/示例播放地址，不能作为真机动漫来源。server/src/plugins/rules20份Kazumi规则均声明useWebview/useNativePlayer，需调查网页解析/嗅探，不能只复制JS后宣称可播。
- 现有手机mediaVideoSourcesProvider直接调用本地getVideoUrl，未实现桌面Playwright嗅探。优先复用media_kit与现有进度/WebDAV；需要补请求头、线路身份和同线续集，具体最小设计待员工核验。

## USB ARM真机（2026-10-31）

- Motorola XT2551-3 Android16/API36/ARM64/4KB实际安装code2成功；WebDAV临时端点安全保存、同步与重启后再同步成功；MangaDex真实搜索/53图阅读/4页恢复6%通过，未修改产品。
- 设备启用OEM双应用，Titanhub有user0/900两份隔离数据；shell启动会出现选择窗。需用户手动选回同一实例后核对持久化，空白的另一份不能算数据丢失；不能通过禁用双开/删数据来绕过。

## WebDAV双端补齐（2026-10-31）

- 最终156手机测试含TypeScript/Dart同DAV真实HTTP交换与507失败重试；115桌面同步回归通过。Android16/16KB实际release界面验证安全保存、连接测试、手动同步、强停重启后保留配置并再次同步；未测真实NAS或ARM设备。
- 手机旧视频position单位是ms、桌面wire为秒，DB同步边界转换；小说wire比例优先应用到本地progress以避免int截断。canonical JSON单独保存防止同version经DateTime降精度后异内容；本地业务写和Lamport/墓碑同事务。

- 桌面server/src/sync实现v1不可变设备代际快照、逻辑时钟、收藏墓碑、pending发布与MOVE核验；手机core/sync只有协议解析/共享向量，尚无DAV网络执行/持久状态/UI。
- 不能用整库覆盖替代现有协议；参考Kazumi的串行提交/临时文件与Venera的直连思路，保持Titanhub自身目录和快照格式。同步范围先对齐收藏与最近位置，不同步媒体/凭据。
- 当前来源ID手机bangumi/mangadex；跨生态同名来源仍须原ID隔离，不能为方便同步按名称猜测映射。

## Android 1.1.0首包（2026-10-29）

* 手机默认本地JS来源与SQLite，无电脑前置；Bangumi只有资料/章节，MangaDex提供图片，Mock不进入来源列表；桌面完整市场与视频/小说来源仍未移植。
* 原g.dart是占位桩，已用真实Drift生成；v1->v2三元身份迁移有真实SQLite回归。阅读恢复需等待数据并主动重建，dispose不能再访问WidgetRef，滚动页码应在布局后按内容viewport计算。
* Android16/API36/16KB真实release包已手工完成搜索→53页漫画及重启后收藏/第4页恢复，360dp与横屏检查通过。单元80项、Android14原生14项通过；API36 debug VM service连接失败未计通过。
* Gradle与Flutter动作必须串行，否则插件注册器可能被test模式覆盖导致release编译失败。flutter_js只需在自身模块统一Java/Kotlin为11，Android模板内存并发已限制；所有native库满足16KB，ZIP与v2签名校验通过。
* SDK/Pub缓存放同卷且DSH临时目录需在workspace之外；DSH已有会话仍可能沿用旧权限配置，出现命令失败后应立即收窄，避免重复探索。dsh收尾上游429已停止，无虚构完成报告。

## 当前移动端现状
* 宿主包名已重构为 `titanhub`，默认显示名称调整为 `Titanhub`，且已具备 logo 图标。
* 客户端使用 Riverpod 做状态管理，Drift SQLite 存储数据，Dio 发送网络请求。
* 目前的 plugin 规则是 JS 脚本，在服务器端是用 `quickjs-emscripten` 库运行的。
