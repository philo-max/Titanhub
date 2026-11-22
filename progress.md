# 进度跟踪日志

## 2026-11-22 ~ 2026-11-23：JM/Venera 漫画网络与反混淆全链路修复（v1.1.2+27）与空间清理

- **问题复现（模拟器 `Zhihui_API_34` / `emulator-5554`）**：同环境下 Venera 能打开 JM 而 Titanhub 打不开，进入章节后全部图片报「图片加载失败，点击重试」。实机 logcat 与抓包共定位 5 处根因：
  1. `MainlandHttpOverrides` 默认无条件劫持所有域名到 `MainlandDohProxy`，覆盖掉 `HttpClient.findProxyFromEnvironment` 系统代理并绕过 VPN/TUN Fake-IP（`198.18.0.0/15`）分流；
  2. `jm.js` 默认请求头带 `Accept-Encoding: gzip, deflate, br, zstd`，部分节点（如 `www.cdnaspa.cc`）返回 `Content-Encoding: zstd` 而 Dart `HttpClient` 仅自动解压 `gzip`；
  3. `VeneraImageProxy` 拼接 `modifyImage` 脚本结尾缺少分号，触发 JS ASI 惨案，QuickJS 报错 `TypeError: not a function at <eval>:92`，导致全部反混淆图片返回 `502 Bad Gateway`；
  4. `package:image` v4 的 `compositeImage` 未显式传入 `dstW`/`dstH`，默认按整图高度拉伸切片，造成画面重影错位；
  5. `onThumbnailLoad` 封面请求头未接入，影响 JM、漫画柜、漫画人、GoDa、nhentai、ehentai、hitomi 等 16 个依赖 Referer 的 Venera 漫画源。
- **修复与优化**：
  - `mainland_channel.dart`：优先尊重系统 HTTP 代理与 VPN Fake-IP/私网直连，仅系统连接失败后回退大陆 DoH（`223.5.5.5` / `1.12.12.12`）。
  - `venera_host.dart` / `venera_source.dart` / `venera_image_proxy.dart`：统一剔除 `accept-encoding` 透传，交由 Dart 自动协商 `gzip` 解压。
  - `venera_image_proxy.dart`：补齐分隔分号与 JSON 封包协议、为 `fillImageRangeAt` 传入 `dstW: w, dstH: h`、将像素解码/拼图/编码迁移至后台 `Isolate.run`（主线程串行 QuickJS 仅记录切块指令）、增加同图请求去重与错误日志。
  - `venera_shim_bridge.dart` / `venera_source.dart` / `main_shell_screen.dart` / `detail_screen.dart` / `search_screen.dart`：全量接入 `onThumbnailLoad` 并向发现页、详情页、搜索页透传封面 `httpHeaders`。
  - `apps/desktop/package.json` 同步至 `1.1.2`，重编 `titanhub-desktop`（`tsc`）与 `titanhub-server`。
- **双重验证**：
  - 白盒：`flutter analyze --no-fatal-infos` 0 error/0 warning；`venera_image_proxy_test.dart` 3/3 通过（含新增 `fillImageRangeAt` 像素级防拉伸单元测试）。
  - 黑盒：模拟器实机验收禁漫天堂发现页 → 详情页 → 第 5 话阅读器 1~4 页全部高清还原、切块严丝合缝、零 `VeneraImageProxy` 报错。
- **构建与发布**：
  - 构建通用 Release APK `apps/mobile/release/Titanhub-1.1.2-universal.apk`（`1.1.2+27`，`118.1MB`），用户真机已安装完成。
  - 推送代码 `2f147fe`、更新日志 `CHANGELOG.md` + `README.md`（`ad45eaa`）及带说明的标签 `v1.1.2` 至 `origin/master`。
- **工作空间清理**：关闭后台模拟器，清理 12 个历史旧版 APK、`apps/desktop` 过期打包目录（`build-out-1.1.0`、`dist-package`、`dist-release`）、NSIS 临时目录与调试截图残留，保留最新正式包 `Titanhub-1.1.2-universal.apk`。

## 2026-11-01：电脑端漫画复现与修复

- Preview6已真实GUI复验成功：电脑界面存第8页→设置页手动WebDAV同步→Android16/16KB正式release界面同步，MangaDex详情15%→继续阅读显示8/53且第8图顶部正好位于viewport（nov01-preview6-page8.png）；用户手势滚动后推进到9/53未被拉回→AndroidGUI同步→电脑设置页GUI同步→继续阅读确实定位第9图（nov01-synced-page9.png）。不再仅是移动内存数据库互通。临时Android DAV配置已经GUI清除，测试输入APK已卸载，自建模拟器已按AVD身份核对后关闭，临时DAV fixture进程已按确切脚本身份停止。
- Preview6修复仅reader恢复锚点与受控图片高度回归，reader11项通过，全量Flutter245项通过/1个可选interop跳过（原独立真实HTTP互通本轮已另跑通过），analyze无error/warning/22条info；release44.6秒成功。包116156827字节，SHA256 68E152A3327BC8B71F8909844384B8E40F3CA55380E358CADC9BEE17684DA7F2，主管核验version1.1.0+6/min24/v2签名/16KB ZIP通过。位置7->第8页恢复与前页增高不退页、用户拖动后释放均有回归。
- 最终桌面检查又复现“全部”搜索请求实际带type=anime（浏览器UI请求契约测试红），漏搜漫画；单独manga正常。已最小改成URLSearchParams按有类型时才传type，服务器原生支持省略type。Web127项再次通过，正在重打Windows安装包并复验该请求契约。此前AB98...安装包哈希将被同名最终包替代，以最后记录为准。

- 16:30阶段补充真实Android GUI WebDAV验收：preview5在自建API36/16KB模拟器配置临时DAV（10.0.2.2:57034/dav/，测试凭据），GUI保存→立即同步显示“同步完成，本机变更均已上传”。MangaDex真实Yotsuba作品详情显示远端第1话15%，但续读图片异步加载后从position7漂到position6，页头7/53，第8图位于下面；发现恢复锚点缺陷，未冒称AndroidGUI精准8页已通过。Claude正在修reader锚点+动态图片高度回归，版本+6，仅一reader文件及测试。
- 当前Android preview5停在WebDAV设置页，已将旧偏移进度上传作为基线；随后实际桌面GUI通过设置页“立即同步”接收，再从单页模式键盘翻至第8页并等position7 API写成功，GUI再同步（脚本.probe/nov01-desktop-ui-sync.cjs，receive/send8均成功）。云端当前第8页版本更新，待preview6安装后直接AndroidGUI同步并续读验证。共享fixture已含真实GUI数据，不再给原单元interop测试使用此fixture，以免singleWhere假设冲突。
- 原生网络根因修复已证实：mpv日志network-timeout20设置成功，真实流14.3秒后打开，H264/AAC与时长24:53已解析，播放进度推进并能恢复原进度。模拟器software及host两种GPU均EGL_BAD_ATTRIBUTE、无视频输出；与media-kit官方issue1343同类（https://github.com/media-kit/media-kit/issues/1343），不能据此宣称真实手机出画。真实手机已断USB，不再催用户操作；手机留preview4，未装diag5。
- Preview5正式无诊断包已构建44秒/4个搜索widget复验/analyze22条info无error/warning；SHA256 FCFA01585C15E3F2580BB7ED5CFF46BA79D94B4034C94F5A9A9D9FA8049F5767，116140443字节，version1.1.0+5/min24/target36/三ABI/v2/16KB ZIP验证。诊断源码已撤回。中间一次诊断构建用了--no-pub致integration_test生成注册表残留编译失败；正常build pub阶段重生成后通过，未改生成文件/SDK缓存。
- Windows最终安装包apps/desktop/build-out-1.1.0/Titanhub-Setup-1.1.0-x64.exe，version1.1.0，104333815字节，SHA256 AB98D5A0A3D2716C9CFF47C4C4845D323D1509A1B57FC8095C8F4CC7E992E1D7，未发布Github/未覆盖用户安装。当前测试桌面独立profile/DB，CDP9235停设置页。

- 最新Web127项通过（新增继续阅读跨来源/失效章节回归先红后绿），server全量302项及图片头/安全转发27项通过，类型检查通过，Web lint仅1条既有img warning。MangaDex原始图片404在Chromium缓存中保持失败，禁缓存实测200；getImages增加来源UA描述符复用既有受控转发后，真实桌面中文第1话53页前4图全部出图（835/1670px），截图nov01-final-reader.png。
- 桌面漫画详情补继续阅读入口，仅同来源/作品且现存章节显示。真实桌面GUI进度通过DAV导入Dart移动内存数据库，再由实际移动存储/同步代码写position7（第8页）传回桌面；GUI点击继续阅读已确实定位并显示Page8，截图nov01-synced-page8.png。此项是桌面GUI↔移动数据层，不冒称本次手机硬件GUI已完成跨端续读。第一次验证脚本点击顶部“单页”导致滚动回首页，已修测试为直接验证第8图位于viewport，无为测试误操作改产品。
- 手机分类搜索完成：全部/动漫/漫画/小说/影视，类型筛选只约束查询不改来源开关，远程回退带type，无来源明确提示。主管独立全量Flutter244项含真实TS/Dart DAV交换全部通过、analyze无error/warning/22条info；release code4构建成功243秒，116140443字节，16KB ZIP/v2签名检查通过。preview4通用包SHA256 01EC0676A196CB097F10F98310DA73127B97CF3065F1088C14FCF5A63C130142，已install-r手机。
- Android16/16KB模拟器实际release GUI分类切换/小说无来源已验。限定Titanhub的临时Instrumentation输入器需要等待UIAutomation就绪且先focus并核对输入文本；修正后可自行输入柯南，避免继续要求用户配合。模拟器本机七色番真实搜索成功，柯南详情当前A线280、B线1265，B线分段1-100/101-200正常；正在验证第01集实际出画。手机当前不在应用前台，不擅自操作其他应用。

- 用户澄清漫画故障在电脑端。隔离桌面win-unpacked GUI（独立SQLite和profile/CDP9234）实际复现：首页MangaDex封面naturalWidth0，而详情页同图经Next优化可加载；《我独自升级》目录首章外链进入阅读器报无CDN文件列表。Claude负责可读章节过滤及过滤后语言回退，root复用SmartImage修卡片，回归先红后绿，Web126项通过；lint无error/1条既有SmartImage原始img warning，tsc退出0。
- dsh按原headless、更新--profile headless及直接可执行程序多次尝试未得到有效任务输出，直接进程返回启动错误，未冒称完成；Claude只读契约报告与agy参考预加载/图片链路报告已收到，关键结论由root复核实际文件。
- 手机已重新install-r code3，系统双应用chooser由用户手选进入。七色番www及无www公开搜索本次均200；实际手机输入Conan只出现Bangumi英文匹配，正请用户输入中文柯南继续真实播放。修正ADB UI helper为每次唯一远程XML并校验dump成功，避免悬浮窗口造成旧XML误读。未删除手机数据/修改系统代理或输入法。

## 2026-10-31：Android动漫接入

- 首轮release配置失败：flutter_inappwebview_android1.1.3调用AGP9不支持的proguard-android.txt。Claude完成工程内compat构建包装（settings动态引用原pub插件目录，Android源码/资源不复制、不改pub-cache/SDK、不降级AGP），改用optimize规则；Gradle插件help和release均exit0（81.5s）。官方beta有对应AGP9修复但未盲升API，稳定依赖下先采用两文件兼容，后续升级需同步检查。
- code3通用release已核验version1.1.0/code3/三ABI、zipalign16和v2签名，116124059字节，USB install-r成功。尚未复制为最终交付包，正等待用户解锁/选择双应用测试实例并搜索柯南后做真机出画与时间推进验证。

- 已落地首个Dart七色番来源、桌面兼容ID/编码、真实HTML夹具；模型headers/type与线路别名、Android可取消WebView解析、共享分线/100集分段选择器、自动/手动同线下一集及播放器请求头/续播/错误重试。root补provider实际解析接线和autoDispose取消、搜索detail外层URI编码，保留原WebDAV/漫画。
- 独立完整Flutter226项通过/1项可选桌面fixture跳过，analyze --no-fatal-infos退出0，无error/warning、22条既有/弃用info。首轮resolver启动失败断言需等异步清理完成；root补跨线同ID回归先红（只line1）再修成线路内去重，两线身份均保留，最终全量通过。
- dsh源码落地并执行来源夹具测试，主管实网初次搜索12条与柯南详情1544条（279/1265），普通Range GET媒体入口206/1024字节；后续相同详情/首页出现多次20秒零响应，原因未定位，不能归因代理或限流。dsh超出限定探索后仍重复核查，主管已停止该headless员工防构建期并发Flutter，未取得规范最终报告，不冒称员工完整交付/媒体可播。原始日志.probe/anime-dsh-source.log。
- Claude的resolver与player交付报告均已保存，agy参考清单已交回。1.1.0+3 release构建正在执行，真机播放尚待验证，不以取到URL/单测成功替代出画时间推进。

- 原1.1.0已批准spec明确包括“真实可用来源搜索/详情/章节/播放”，本轮继续该既有架构和用户补动漫要求，未重复申请同一多文件授权；细化方案与步骤已落docs/superpowers/specs/2026-10-31-android-anime.md及plans同名。
- dsh只读报告受web_fetch假IP校验阻断，不能据此断言站点失效；主管普通HTTPS curl成功获取7sefun真实柯南搜索12条、其中TV版/voddetail/27146.html。Web工具另可打开7sefun首页，AGE403。dsh进入单来源实现，Claude进入Android解析/契约实现，agy已交回4条参考验收判据。原生播放不需要CORS代理，清晰度菜单也不等于已实现多线路，这两点未采纳员工泛称。

- 用户要求补动漫。已启动dsh真实来源只读调查、Claude关键架构审查、agy参考触屏清单；本轮先收敛可审阅设计，未改产品或构建。根目录计划保留既有状态，全部旧改动保留。
- 初查发现桌面几份内置anime JS仍是mock/示例，20份Kazumi规则都使用Webview。手机缺headers与线路字段，需完整来源→选集→解析/嗅探→media_kit链路，不能只打开入口。

## 2026-10-31：USB真实手机

- 真机Motorola XT2551-3/Android16/API36/arm64-v8a/4096页，安装-r最终code2 APK并启动成功。dsh限4文件只读复核已完成，日志.probe/usb-dsh.log；其Keystore/重定向建议为静态可能性，不是已复现Bug，未据此改产品或放宽校验。
- 实际GUI以隔离DAV经USB reverse 57729验证：新配置安全保存/密码不回显/连接测试/同步成功。重启遇OEM双应用chooser和锁屏，用户解锁并手动选回保存实例后，确认URL/账号/保存密码标记/原同步时间保留，再同步成功（20:43）。两个实例user0/900数据隔离，另一空实例不算配置丢失。临时配置已应用UI确认清除，原数据未清除；未连接用户真实网盘。
- 真机本地JS引擎真实MangaDex搜索Yotsuba→0a580438-bc72-4503-940b-12a5da881b56详情→中文第1话ccc455f2-b5ad-40fe-a8bc-72330368e195共53图，截图.probe/usb-reader.png已目视实际漫画。翻页4/53→返回详情显示进度6%→点上次看至恢复4/53（usb-reading-progress.xml/usb-resume-confirmed.xml）。留在阅读页面，测试阅读记录保留供继续验证。
- 应用日志仅见两条Flutter frame-time clamping诊断，无Titanhub崩溃证据；误查全局crash时见其他进程历史，未算作本应用问题，后续限定PID。GUI自动化返回键/坐标遇第三方IME与系统chooser，已改用应用按钮/实际XML并让用户处理系统选择。一次PowerShell大小写HOME变量名错误已弃用，后续均用phoneHome专用变量，未改用户环境。
- 本轮仅增加验收记录与.probe脚本，产品代码未改、未重打包、未提交/推送；此前156/115项为上一轮源码验证，未冒称此次重新执行。真实视频/小说、外屏折叠布局、用户NAS仍未测。

- 用户已授权真机USB调试。adb识别一台device状态XT2551_3，未执行手机数据删除或配置替换。开始只读设备/安装版本检查后安装已有最终WebDAV APK。

## 2026-10-31：手机WebDAV与双端兼容

- 最终APK：apps/mobile/release/Titanhub-1.1.0-webdav-universal.apk，114951145字节，SHA256 C3E414B242B095D1EB02D35B9152E6A41C2A7794032160C706AA066363C92271。release构建退出0（199.4s），version1.1.0/code2/min24/target36，arm64/armv7/x86_64；zipalign -P16与v2签名复验成功。保留原首包，不提交、不推送、不覆盖用户实际安装。
- Android16/API36/真实16KB隔离模拟器安装升级成功：实际GUI入口→填写临时DAV→显式HTTP→安全保存→密码清空不回显→连接测试成功→同步成功→强停重启→地址/账号/保存标记/时间保留→再次同步成功。360dp小屏目视无布局溢出、可滚动到操作按钮；flutter:E/AndroidRuntime:E无日志。证据.probe/webdav-settings-{saved,tested,synced,restarted,resynced,small}.xml与small.png。真实网盘/NAS和ARM手机仍未验证。
- 当前安全存储为11.2默认AndroidOptions；Claude报告中9.2/encryptedSharedPreferences为中间设计，不能当最终实现。桌面/手机同步仅收藏和最近进度，未扩大来源目录、未连用户网盘；dsh/Claude/agy均已有结果。

- 完整手机156项实际通过，TITANHUB_INTEROP_BASE启用的desktop_interop_test未跳过，真实TypeScript桌面与Dart手机同DAV交换/取消收藏/页码/507失败重试及期间新修改均通过；桌面src/sync115项通过。首轮2项夹具错误（非法JSON错用为generation冲突、fake未保存状态）修正后全量重跑。analyze --no-fatal-infos退出0、无error/warning、20条弃用info。
- 集成补dispose关闭Dio、按AppDatabase实例单飞锁、损坏配置可清除；Android禁备份并在dataExtractionRules排除云/D2D数据，HTTP仅设置显式允许（manifest开放以支持该选择）。安全存储升级为11.2默认Android方案，恢复9.2解析导致的播放依赖降级，已复跑上述完整测试。
- 1.1.0+2 release构建正在运行，Android16/16KB隔离模拟器已启动。员工均已交回：dsh21传输测试为adapter夹具，不冒充真实HTTP，其真实网络证据由root跨运行时fixture测试补充；agy片段审查、Claude协议/UI/执行器报告保存在.probe。

- root已实现schema3自定义同步状态表/业务写同事务记录、收藏墓碑、pending不可变持久化、视频ms与wire秒/小说比例转换；数据库相关20项回归实际通过（含新7项），局部Dart analyze无问题。升级/重开测试有Drift多实例诊断提示，使用的是互相隔离的临时测试库。
- dsh大任务在反复探索无产品落地后停止，收窄只做DAV transport；Claude完成只读审查和设置UI（尚待执行Widget测试），继续执行器/安全配置与桥接。agy文件调研240秒超时，改提供真实代码片段后交回有效复核，未冒充独立文件调研成功。
- 临时双运行时DAV fixture已启动，仅临时SQLite和本机随机端口；首次ESM/CJS导出解析失败已改default导入，成功启动。手机实际互通测试尚未执行。

- 已检查现有桌面同步与手机协议边界，三位员工分工已启动，日志在.probe/webdav-{dsh,claude,agy}.log。agy首次CLI超时参数缺单位已纠正为240s，尚未计调研完成。
- 保持codex/android-1.1.0现有分支，保留所有旧修改；Flutter命令仅由dsh串行执行直到交接，主节点只读检查与规划。

## 2026-10-28：启动1.1.0 Android适配

* **2026-10-29最终首包**：apps/mobile/release/Titanhub-1.1.0-universal.apk，113884877字节（108.6MiB），SHA256 D64913D26C4DA2A1D7F02C2E7D744A7414A86844ECBC52F0EC0ECFE29CFB7631。最终构建退出0并重新安装启动，zipalign -P16和v2测试签名校验通过；未提交、推送或发布，未改实际手机/桌面安装。
* 最终源码验证80项单元、9项阅读Widget包含其中、Android14原生14项；analyze无error/warning、18条既有弃用info。Android16自动化两轮在VM service加载阶段失败，未计通过。API36/16KB实际release GUI已验证真实MangaDex搜索→中文章节→53页图片、收藏重启仍为“取消收藏”、历史“第1话/6%”以及继续打开恢复“4/53”；记录在.probe/android16-restart-detail.xml与restored-reader.xml。360dp及640dp横屏来源面板无RenderFlex或应用崩溃日志。
* 最后仅清理Detail两条员工新增注释并重建（行为相同），最终hash为D64913...；之前40709D.../2726E5...是迭代包，不能作为本次交付哈希。CLI调试失败保留原始日志，不把真实release验证冒充自动化通过。详细阶段与遗留见实施计划。

* Android16/API36/16KB环境已启动（Titanhub_API_36_16KB，隔离AVD在.probe/avd；实际getconf PAGE_SIZE=16384）。第一份通用release APK已构建113884877字节，包名com.titanhub.titanhub/version1.1.0/code1/minSdk24/target36，含arm64-v8a/armeabi-v7a/x86_64；zipalign -P16与v2签名校验通过（Android Debug测试证书）。ARM64七份native库及x86_64六份库LOAD对齐均>=16KB。
* 第一份release已在API36 16KB安装启动，并通过真实UI搜索Yotsuba→MangaDex作品0a580438-bc72-4503-940b-12a5da881b56→中文章节→ccc455f2-b5ad-40fe-a8bc-72330368e195的53页，已目视第一张真实图。无应用崩溃日志。截图.probe/android16-home.png和reader.png；UI XML保存同目录。API36 debug自动化两轮（含--no-dds）均在VM service加载阶段断线，不能计通过，也不能把此错误当站点失败；API34原生14项实际通过仍有效。独立live_source_test.dart尚未成功运行（加载阶段失败），不声称其通过。
* Claude完成漫画/小说晚到进度与用户先滑动的6项Widget回归。Codex补退出保存先红后绿2项：捕获SyncService供dispose使用，小说controller卸载后回退最近记录，避免无效ref读取吞保存。再补大幅跳页1项先红后绿：滚动后帧末按内容viewport顶部计算页码，解决上一帧页码；9项阅读Widget通过。阅读与记录标题改用真实章名/人类可读回退，不显示UUID。当前正在重新跑完整80项与打最终包；此前40709D...哈希仅第一份包，不是最终交付。
* README已更新手机默认本机运行、两份来源边界和本地构建/测试签名说明；.probe加入忽略以免SDK/诊断误提交，两个dsh临时写入探针已读后移入.probe保存，未删除用户文件。保留全部桌面/server既有未提交工作，不发布。

* 最新：用户Android16、希望覆盖更多型号，API36 Google APIs ps16k镜像正通过新版Android CLI下载（旧sdkmanager shim错误拆分分号包名，改用android.exe sdk install system-images/android-36/google_apis_ps16k/x86_64）。尚未宣称Android16已测或所有品牌兼容。
* dsh引擎与持久化写入已保留，但最后任务以429额度错误结束（提示2026-10-29 13:30:17 UTC+8恢复）；CLI返回0且final为空，不能计为正常交付。停止再调用，Codex集成/Claude限定复核修复。
* Codex实际原生测试：.probe/mobile-native-engine-retest.log，Android14/API34/emulator-5554，14项通过，覆盖请求/解析/错误/dispose/超时/并发；初轮仅HTML夹具拿li属性而非子a造成1失败，已修夹具重跑。最新Flutter unit71项通过，analyze --no-fatal-infos退出0（18条API弃用info）。早期89项是引擎测试收尾前的历史计数。
* 构建环境修复flutter_js Java11/Kotlin1.8目标冲突，仅在Android根build.gradle.kts对该模块Kotlin目标设11；限制Gradle为3GB/2workers/不并行。Codex先前误并行Flutter build/test导致资源争用及GeneratedPluginRegistrant混入integration_test，release失败，已改所有Flutter动作顺序执行；最终APK仍待重新打包。
* Claude关键只读报告.probe/claude-apk-critical-review.log：未发现DB迁移/复合身份阻断，提出漫画晚到进度缺setState时序。限定修复任务.probe/claude-apk-restore-fix.txt，当前执行会话29602、日志同名.log；不并行Flutter命令，待它测试结束再打包。已准备普通公开来源live_source_test.dart，默认跳过，需dart-define TITANHUB_LIVE_CHECK=true实际验证，尚未运行。

* 用户已批准docs/superpowers/specs/2026-10-28-android-1.1.0.md范围；计划在docs/superpowers/plans/2026-10-28-android-1.1.0.md。Flutter3.47.8与Temurin17已官方哈希校验，隔离于.probe/tools；Android工具/许可证已就绪，emulator-5554(Android14/API34)已启动。环境脚本.probe/apk-build-env.ps1仅影响调用进程，TEMP放F:/tmp/titanhub-apk-110，修复Pub跨盘rename和dsh工作区内临时目录问题。
* 已生成独立临时Flutter模板并仅复制缺失Android工程/.metadata/.gitignore，未覆盖lib；版本1.1.0+1，补path/path_provider及integration_test，pub get成功并保存lock；主manifest加INTERNET。APK尚未构建成功，未安装或发布。
* dsh本地模式已实现（来源清单/能力与UI、默认不连电脑、去Mock入口）；后续移除新增注释。报告.probe/dsh-apk-local-mode-resumed.jsonl及final.jsonl。其曾越界修改detail_screen，已停止其再次写入，由持久化员工接续整合；不采信其“API加法兼容”泛称，需以最终编译/测试为准。
* dsh持久化任务新会话（TEMP已修正）在.probe/dsh-apk-persistence-fixed.jsonl，执行中，负责真实Drift生成/迁移与跨源数据/播放器阅读恢复；JS引擎员工在.probe/dsh-apk-engine-resumed.jsonl，执行中，负责Response与native集成夹具。前两轮命令ACL错误未计测试通过。
* Codex实跑本地来源及同步协议20项通过；首次analyze发现旧g.dart手写占位，目前员工已用真实生成器替换，最终分析待稳定后重跑。Android Gradle9.3.1官方URL下载慢，镜像下载后逐字节SHA256对照官方通过；wrapper成功运行。首次Kotlin插件解析瞬时失败，refresh-dependencies重试已进入正常Maven下载/NDK28安装；诊断.probe/gradle-plugin-diagnostic.log。不得将阶段构建失败或静态测试当手机可用验收。

* 用户明确APK需手机独立使用；以已有Flutter客户端为基础，dsh参与开发。只读初查发现Android目录缺失、SDK工具不在PATH、默认请求电脑服务后回退及模拟来源混用。
* dsh只读报告.probe/dsh-apk-audit.jsonl，有真实读取证据；其“在线来源完全离线”表述不准确、超出15次工具上限，以及建议明文token存储未采纳。已切codex/android-1.1.0，保留桌面/服务端未提交工作。

## 2026-10-28：漫画首页批量失败与同名来源

* 最新状态：用户授权Codex接手剩余修复，现已完成Venera首页桥、旧包装运行时升级、fetch契约与CPU预算、来源身份/语言分组、私服待配置和安全错误分类。保留来源ID、启用状态、收藏与进度；不绕过网络安全校验。
* 最终回归：Claude恢复后复核发现网络等待循环缺总上限和已安装跨类型同名分组问题，已由Claude补失败回归并修复。Codex独立复跑server300、web124，adapter82通过/2跳过；全仓库Lint通过（既有图片警告）。Chromium实际组件验证来源分组/语言/按ID安装/配置提示及视频和漫画回归通过。真实公开来源曾返回Komiic20条、Venera MangaDex60条，Komiic另一次DNS超时，不能宣称所有来源可用。
* 新调用上限：默认60秒总时限（35秒CPU的视频调用总时限70秒）、300次fetch；超限终止脚本和在途fetch，丢弃残留上下文。首页8秒超时未即时取消底层，但后台工作已受上述上限约束；嗅探中途/DNS仍依赖自身有限超时。agy两次文件读取及无工具片段复核均未交有效报告，未计通过。Claude报告.probe/claude-source-current-review.log和.probe/claude-source-review-fix.log。
* 最终本地1.0.10安装包：apps/desktop/build-out/Titanhub-Setup-1.0.10-x64.exe，104331600字节；SHA256 DEB0D2F322ED35957D9B08BF901C28A982CBB19451CBD8DCD9A25D768B207EEA。完整生产构建/类型检查与NSIS打包退出0，包内已确认含新调用限制与Venera首页桥。未安装覆盖用户客户端、未提交推送或发布；以下额度受限记录为历史。

* 两个Claude实施任务均返回session limit，12:30北京时间恢复；本轮只有诊断/方案文档，没有把宿主或来源展示修复写入产品，现有1.0.9仍保留。已异步询问用户是否由Codex接手，未在授权前替代程序员。

* 用户确认1.0.9漫画首页未搜索即报错。Claude只读复现Venera缺explore、fetch缺ok/headers且json返回字符串、VM网络等待计入5秒中断；Komiic搜索48条但首页方法未定义；内置MangaDex首页12条、Mangayomi英语20条。报告 .probe/iteration-sources-claude-audit.log。
* 经理核对快照：MangaDex46、Comick42、拷贝2个同名生态/语言版本，不是真正重复ID。agy目录工具轮5分钟超时，缩小后的无工具展示复核已交回，未冒充独立目录验证。
* Claude宿主修复会话19575、产品整理会话13242已启动，工单在.probe/sources-claude-*-fix.txt。禁止删除来源/旧ID/进度、禁用用户来源或改网络设置；保留1.0.9工作。方案文档 docs/superpowers/specs/2026-10-28-source-home-compatibility.md。

## 2026-10-28：新迭代调度

* 已交付本地1.0.9：`apps/desktop/build-out/Titanhub-Setup-1.0.9-x64.exe`，104318084字节，SHA256 `BA0CA04B11B1CBF7B54CAAFE120FA439D66B0876019A1D8AED9EFAD37315AA6F`；未提交推送或发布，未替换用户安装。
* Claude完成视频、漫画及视频复核收尾；agy提供验收和代码预审，最终图片复核超时未计通过。经理复现并退回重复ID串线、详情页切线路重置分段问题，Claude补回归修正。
* 经理独立最终验证：Web121、adapter75通过/2跳过、server270、desktop窗口1通过，全仓库Lint与完整生产打包通过；现有图片警告保留。桌面全套烟测仍有3001占用限制，未宣称全通过。
* 独立Chromium使用实际VideoPlayer/EpisodeSelector/漫画阅读器组件验证：恢复后自动起播、暂停后切清晰度不重播；1200集乱序分线/100条渲染/当前分段/切线路分段保留；图片500后重试URL不变和翻页进度；模拟NotAllowedError显示手动播放且不静音。夹具隔离导航/进度API，不冒充真实已安装客户端验收。脚本 .probe/iteration-manager-browser.cjs。
* 真实来源证据：7sefun《柯南》1544条/2线、AGE9825条/8线（各线1275/1277等），另有1219集单线及383条剧情标题来源；不将总记录当真实集数。样本 .probe/conan-sample.log。Claude真实MangaDex验证Yotsuba搜索→详情→113章→53图，首图200；Conan英语1560条版本记录，分页数量与API total一致。
* 已知限制：旧进度同ID跨线重复且无线信息时需重新选线；未知标题和特别篇不猜编号；图片转发令牌30分钟/重启失效需重新进入章节，共享fake-IP传输有5MB上限；Cookie鉴权来源、Venera onImageLoad和DM5空壳未在本轮解决。

* agy 缩小后的两项任务已完成：15项验收清单与MangaDex五文件审查；不采纳其直接追加retry查询参数、按最新汉化组删章节、未经确认新增语言码建议。
* Claude 漫画实现会话18705，工单 .probe/iteration-20261028-claude-implement-manga.txt。与视频会话限定文件写入边界，漫画不得改共享Chapter类型、Kazumi和视频文件；安全图片转发必须逐跳校验、限制头/大小/超时，旧string[]兼容。

* 用户要求 Codex 规划验收、Claude 编程、agy 实习复核；范围为自动播放、千集选集整理、同源线路拆分和漫画接入，长篇样本为《名侦探柯南》，未指定来源。
* Claude CLI 只读调查已完成：Kazumi XPath/API 跨线路累加编号，CSS 丢线路边界；首次播放不自动play；漫画图片头被丢、阅读器直连、重试签名URL风险、MangaDex章节不分页。报告 .probe/iteration-20261028-claude-audit.log。
* 已启动 Claude P1-P3 实现，工单 .probe/iteration-20261028-claude-implement-video.txt，终端会话26509；要求稳定旧ID、恢复后自动播放、暂停不被顶掉、同线路下一集与100集分段，禁止新增连播倒计时。
* agy 第一轮3分钟超时无有效报告，已缩小为基于证据的无工具验收清单任务；不把超时当复核通过。自动通知不可用，由经理检查真实终端结果。

## 2026-10-26：启用手绘拟人 Logo

* 用户确认采用第二版手绘形象。将内置 imagegen 已生成原图复制到网页 logo 与 Flutter 图标源，并生成 192/512 图标；原图标和快捷键版 1.0.8 安装包保存在 .probe/logo-before-mascot。
* 新增网页标签图标声明，离线缓存升级为 titanhub-static-v2。Web 89 项测试和 Lint 通过，完整桌面构建（含类型检查）与安装包重建成功。
* 已目视确认 Windows EXE 提取图标为新头像，内置网页图标哈希与源一致。新本地 1.0.8 含新 Logo 和快捷键修复；未上传 GitHub、未覆盖用户安装目录，Flutter 仅更新图标源、未构建客户端。

## 2026-10-26：播放器快捷键

* 根因：VideoPlayer 自定义控件未注册键盘监听。补充空格播放/暂停、左右跳转 5 秒、上下音量 5%、M 静音、F 全屏；播放状态跟随媒体事件，输入与原生控件操作受保护，卸载清理监听。
* 回归先红后绿；Web 13 文件 89 项通过，tsc、Lint 与完整桌面生产打包通过。Chromium 用真实播放器与本地可跳转 WAV 验证播放/暂停及控件状态、跳转边界、音量/静音、全屏、弹幕输入、修饰键、聚焦按钮和卸载。测试媒体服务器补齐 Range 响应后跳转验证通过，未以媒体夹具问题修改产品逻辑。
* 本地产物 `apps/desktop/build-out/Titanhub-Setup-1.0.8-x64.exe`，101845358 字节，元信息 1.0.8；已确认内置前端包含快捷键代码。未安装到用户现用目录，未上传发布。

## 2026-10-25：1.0.7 安装包（Claude）

* 版本 1.0.7，`apps/desktop/build-out/Titanhub-Setup-1.0.7-x64.exe`，101844788 字节，SHA256 `33b51433561bbc55e1a58c8f19629897bd7d994f31814c0effcfa00360dbf70e`，元信息 1.0.7.0。包内确认含：网页会话直连（主进程 setProxy）、播放页自动换源（前端包内含“尝试其他来源”）、详情页换源区块。
* 回归：adapter 68（2 跳过）、server 250、web 61、desktop 60 全部通过；packaged-smoke 6 项通过（清除代理变量，客户端未运行）。未在安装后的客户端里实测直连提速与自动换源；用户 E 盘当前装的版本早于 1.0.7，尚未安装（覆盖安装需用户 UAC）。未提交、推送或发布。


## 2026-10-25：播放失败自动换源 + 视频来源换源列表（Claude，未打包）

* 新增 `apps/web/src/lib/source-fallback.ts`（含 6 项测试）：`cleanTitle` 清洗站点页面标题（取《》内标题或去掉站点后缀）、聚合搜索得到候选来源、按集数（chapterNo，退回序号）在候选来源取同一集、最多 5 个依次尝试取播放地址。
* 动漫播放页：取视频失败（报错/无源）时自动尝试其他来源，加载界面显示“正在尝试其他来源：X（n/m）”；成功后把结果写入 `playbackCache.set` 并 `router.replace` 到新来源播放页，带 `?tried=` 避免重复尝试；全部失败才显示播放失败。
* 动漫详情页：视频来源也显示“换源”区块（其他来源链接，后台探测并移除确认为空章节的）；跨源搜索改用清洗后的标题（此前 AkiAnime 等页面标题带站点后缀导致匹配不到）。
* 验证：本地后端 + 3100 端口网页，从 aafun《尼古喵喵》第 1 话（该源取不到地址）打开，依次尝试 7sefun→akianime，约 17 秒后自动落到 akianime 并拿到视频地址；akianime 详情页换源区块列出 13 个其他来源（ezdmw 因空章节被移除）。web 61 项通过，tsc/lint 通过。未在 Electron 客户端实测，未打包。
* 已知限制：只覆盖“取地址失败”，播放器已拿到地址但视频无法解码/加载时不会自动换源；未覆盖影视/漫画页；不同源的集序可能错位（按集数匹配，非绝对准确）。


## 2026-10-25：aafun 播放慢的根因（Claude）

* 用户截图：1.0.6 里 aafun 第 1 话黑屏 00:00/00:00，怀疑源有问题。用打包客户端（独立 profile + 调试端口）驱动播放实测：嗅探取地址约 10–20 秒，随后视频才起播；`play.xfvod.pro:8088` 的 mp4 约 600MB、moov 在文件尾，浏览器需额外一次尾部 Range 请求。
* 关键对照：同一 mp4 用 curl 直连首包约 1 秒、约 2MB/s；经系统代理 127.0.0.1:7891 仅 24–84KB/s（4MB 要 47–60 秒）。Electron 网页默认走系统代理（HKCU ProxyEnable=1），所以视频在客户端里慢，并非源失效。
* 修复（未打包）：桌面主进程启动时对 `session.defaultSession` 设置 `mode: 'direct'`（后端本来就直连，依赖 TUN）；设环境变量 `TITANHUB_USE_SYSTEM_PROXY=1` 可恢复系统代理。新增 2 项测试；desktop 测试通过。以源码启动的客户端复测，视频请求约 1 秒返回 206、尾部 moov 请求约 1 秒完成。
* 未解决：每集嗅探取地址仍要 10–20 秒（加载整页 SPA），是首次点击等待的主要部分；需 1.0.7 打包才进客户端。


## 2026-10-25：1.0.6 安装包（Claude）

* 版本 1.0.6，`apps/desktop/build-out/Titanhub-Setup-1.0.6-x64.exe`，101841278 字节，SHA256 `bec660b31b6c9b2d3b823f7d774e9ac8024ad54c626287e335a1822db7a41b5c`，元信息 1.0.6.0；包内网页为新构建。包含 1.0.5 之后的三项前端修复：换源探测改后台且只移除确认为空的来源、悬停预取限 1 并发、播放页不再等章节/弹幕。
* 回归：adapter 68（2 跳过）、server 250、web 55、desktop 58 全部通过（清除代理变量；构建时客户端未运行），packaged-smoke 6 项通过。未在安装后的客户端里实测播放耗时；视频首包慢属 CDN/网络。未提交、推送或发布；用户 E 盘当前装的是 1.0.5 或更早，1.0.6 尚未安装。


## 2026-10-25：1.0.5 安装包（Claude）

* 用户反馈部分来源时好时坏，随后恢复，判断受网络慢影响；提出 aafun 章节为空、空章节来源不应展示。修复：①沙箱把 `./`、`(/` 开头的相对 XPath 交给 XPath 引擎，不再当 CSS（moonci 视频链路恢复）；②Kazumi 章节线路为空/无效（aafun 的 `chapterRoads: "//"`，上游即如此）时退回整页解析（aafun 验证到可用 mp4）；③服务端启动时把旧版 LNReader 垫片存储的已安装来源升级到新运行时（Free Kol Novel、Galaxy Novels、dilar tube）；④动漫详情页换源列表先探测章节，空章节/失败/20 秒超时的候选不再显示。新增测试：相对 XPath、旧 LNReader 升级。
* `verify-sources.ts` 新增 `--db=`（直接验证用户数据库副本里已安装来源，57 个中 12 通过）与 `--id=`。
* 版本 1.0.5，`apps/desktop/build-out/Titanhub-Setup-1.0.5-x64.exe`，101841107 字节，SHA256 `5d1afe9dd7fd926cf4b9997d66bfe0930f3262576dbb02e3e9f3521d7489d940`，元信息 1.0.5.0，包内 server dist 含新修复。回归：adapter 68、server 250、web 54 通过。
* packaged-smoke：首次因 127.0.0.1:3001 被用户运行中的 Titanhub 占用（EADDRINUSE）仅 4/6；用户关闭客户端后重跑 6 项全部通过。未提交/发布；换源过滤未在界面实际观察。

* 追加（1.0.5 之后，未打包）：用户反馈 aafun 详情页卡 2–3 分钟。原因是我加的换源探测放在章节加载之前且等全部结束，聚合搜索加探测拖住了整个页面；同时超时即剔除会误伤慢源。改为：章节立即加载；换源列表先显示全部候选，后台逐个探测，只移除“明确返回空章节”的，超时/报错不剔除；页面卸载即取消。验证：本地后端+3100 端口网页，aafun 详情页 2.5 秒内显示 25 话；web 54 项通过、tsc/lint 通过。需要重新打包（1.0.6）才能进入客户端。

* 追加（未打包）：用户反馈 aafun 显示话数但点进去迟迟播不出来。实测：aafun 取播放地址在本地后端约 8–13 秒（无头浏览器加载播放页并嗅探），且服务端嗅探只有 2 个并发槽位；前端鼠标悬停 150ms 就会预取该话视频，扫过多集会占满槽位，真正点击的那一集要排队。修复：①`playbackCache` 预取同时只保留 1 个，给点击留槽位（新增测试）；②播放页不再 `Promise.all` 等章节列表和弹幕，视频地址一到就开播，章节/弹幕后台补齐。验证：本地后端+3100 网页直开第 4 话播放页，约 4.6 秒内 video 拿到地址，约 8 秒后开始解码；该 mp4 来自 play.xfvod.pro:8088，首包本身约 8 秒，属 CDN/网络延迟，代码改不了。web 55 项通过、tsc/lint 通过。需 1.0.6 打包才进客户端。


## 2026-10-24：1.0.4 安装包（Claude）

* 版本升至 1.0.4，`pnpm package:desktop` 构建成功：`apps/desktop/build-out/Titanhub-Setup-1.0.4-x64.exe`，101840173 字节，SHA256 `e4771d3a08030064cc76131a52802cace6eddbb1c7127a70a8f49ea6d6b00e57`；解包 Titanhub.exe 元信息 1.0.4.0，包内 server dist 含 LNReader 运行时与打包的 cheerio/htmlparser2/dayjs，未含数据库/JWT 密钥。
* packaged-smoke 6 项通过。未重跑全量回归，也未在安装后的 GUI 里实际阅读 LNReader 小说；用户 E 盘当前装的是 1.0.3，1.0.4 尚未安装（覆盖安装需要用户 UAC）。未提交、推送或发布。

* 全量回归（清除 HTTP(S)_PROXY 后）：adapter 68 项（2 跳过）、server 24 文件 248 项、web 11 文件 54 项、desktop 10 文件 58 项全部通过；四个工作区 tsc --noEmit 无错误；lint 全部退出码 0，仅 web 既有 `<img>` 警告。1.0.4 安装包的构建先于本次回归，构建内容未变。


## 2026-10-24：LNReader CommonJS 运行时桥接（Claude）

* 新增 `packages/plugin-adapter/lnreader-runtime.ts`（CommonJS `require`、`@libs/fetch|storage|filterInputs|novelStatus|defaultCover|isAbsoluteUrl`、URL/URLSearchParams/Headers/FormData/AbortController/atob/btoa/TextDecoder/TextEncoder/Intl 垫片、默认 export 桥接到 search/explore/detail/chapters/content，分页章节最多取 20 页），及 `scripts/build-lnreader-libs.mjs` 把真实 cheerio(slim)/htmlparser2/dayjs 打包为 `lnreader-libs.generated.ts`（约 201KiB）。为适配器包新增 cheerio/htmlparser2/dayjs/esbuild 开发依赖，pnpm-lock 随之变化。
* 新增服务端沙箱内测试 `server/src/plugins/lnreader-adapter.test.ts`（4 项）；适配器包 68 项通过。sniffer/validating-proxy 的 3 项失败仅因 shell 带 HTTP_PROXY，清除后 6 项通过。
* 全量重验 321 个 LNReader 源：63 个全链路通过（此前 0），其余为站点问题（搜索无结果、Cloudflare/验证码/403、HTML 响应、证书、沙箱 URL 拦截、超时）及少量宿主缺口（@libs/aes、protobuf、个别 undefined 读取）。`sunovels` 正文仅 53 字符，不算真正可读。明细已更新到 `docs/source-verification-2026-10-24.json`。
* 边界：通过仅代表取得首章正文，未在阅读器中实际阅读；未提交、推送或打包。


## 2026-10-24：逐来源真实验证（Claude 接手 Codex 额度用尽后的工作）

* 新增 `server/scripts/verify-sources.ts`：对目录来源下载→适配→真实沙箱执行 搜索→详情→章节→播放地址/漫画页/小说正文（搜索结果取前三个尝试），清除 HTTP(S)_PROXY 后在 TUN fake-IP 下运行。完整逐条结果见 `docs/source-verification-2026-10-24.json`。
* 汇总：kazumi: 共17,通过4,失败13,跳过0；venera: 共33,通过11,失败22,跳过0；mangayomi-manga: 共363,通过19,失败95,跳过249；mangayomi-novel: 共5,通过0,失败5,跳过0；lnreader: 共321,通过0,失败321,跳过0。
* 全链路通过 kazumi（4）：girigirilove, akianime, xfdmneo, xfdmnext
* 全链路通过 venera（11）：jm, copy_manga, copy_manga_multi_accounts, Komiic, wnacg, ykmh, manwaba, ManHuaGui, hot_manga, jcomic, mxs
* 全链路通过 mangayomi-manga（19）：202373705, 689496451, 545017689, 110023605, 767687578, 511907642, 986826068, 183977130, 417850874, 127887438, 399589398, 683661227, 367421943, 736630443, 385031783, 88174952, 1008587213, 778357609, 28305267
* 失败归因：
  * LNReader 321 个全部失败：其中 318 个报 `did not register a global`——真实 LNReader 插件是 CommonJS 模块（require @libs/*），现有适配器未实现模块运行时，需新增桥接；另有缺 `Headers`/`Intl` 宿主 API 各 1、证书域名不匹配 1。目前不应在市场中把 LNReader 标为可用。
  * Mangayomi 249 个为 Dart 源，运行时未接入（跳过）；JS 源 119 个中 19 通过。41 个 comick 系源失败：api.comick.fun 经 Cloudflare DoH 查询返回 NXDOMAIN，站点已失效，非宿主缺陷。另有 25 个章节为空、6 个 detail 缺章节、7 个 `cannot read property 'state'`（宿主 API 适配缺口）、2 个下载 404。
  * Venera 33 个中 11 通过；其余为站点 403/HTML 响应、`createUuid` 未定义、Cookie 管理/二进制 HTTP 不支持（宿主缺口）及无搜索结果。
  * Kazumi 17 个中 4 通过；其余为章节为空、403、无搜索结果、嗅探未得地址或超时。
* 边界：脚本中视频嗅探走 Playwright 而非桌面 Electron，Kazumi 播放结果只作参考；单次关键词搜索与前三条候选，站点临时波动、地区限制可能造成误判；通过仅代表取得首章可用地址/页面/正文，未实际在播放器里播放。未提交、未改用户代理或本地资料。


## 2026-10-24：重启后接续

* 聚合修复最终验收：1.0.3 NSIS 包直接解压到仓库外中文/空格路径，清除 NODE_PATH/NODE_OPTIONS，用包内 Titanhub.exe 和独立 profile/SQLite 真实启动 GUI。最终首页返回 55 条内容，Bangumi success 12 条；可见卡片动画完成后进入真实详情，搜索页面实际显示 17 张 Bangumi 卡片，浏览排行写入 SQLite；无页面异常。所有五个内置演示来源（含经理复核发现的 TVer 测试流）均未参与首页/搜索/排行推荐。证据在本轮临时目录 `real-ui-1792847454177/result.json` 及截图。
* 网络方案经历一次被拦下的失败：undici8 在 Node24 验证成功，但 Electron Node20.19.1 的 markAsUncloneable 缺失使后端崩溃，桌面回归真实报 3 项失败，临时包未交付。已替换为原生 HTTP/HTTPS 固定公网地址、保留原域名/TLS、身份编码、限额与异常清理；不再顶层加载 undici。Node/Electron 仓库外生产副本各通过真实 explore12/search17/detail 与聚合；Claude 对最终原生方案复审并实际运行 Electron，agy 完成只读风险核对。
* 最终独立回归：server 214 项、web 52 项、desktop 53 项通过；相关类型检查、lint 与安装包构建通过，Web 仅既有图片警告。最后排除 TVer 演示后的 server 214 项再次通过，最终包 GUI 和 packaged 6 项再次验收通过。1.0.3 安装包 101568031 字节，SHA256 `6792CE70C0C9EF9BA056D7E7CEE20DEC0766F1BD03C90DB08437FA7849686D2A`；包含 QuickJS/SQLite 两份 WASM，未含用户数据库/密钥/网盘配置。
* 边界：本次验证首页、搜索、详情和来源执行，不代表各站播放/阅读均已适配。Bangumi 仅资料；少数来源仍超时或拒绝，错误独立展示。fake-IP 兼容不覆盖视频嗅探/m3u8、纯 IPv6 或显式 HTTP 代理组合，均维持失败关闭；正常公网模式不变。用户 E 盘仍是 1.0.1，尚未替用户安装 1.0.3，未改本地收藏进度、系统代理，未提交/推送/GitHub 发布。干净系统与实际 UAC 升级仍待用户安装验收。

* 聚合故障实际复现：用 E:/Titanhub 的 1.0.1 后端、独立临时数据库和最小离线脚本，explore 返回 createRequire(undefined)，生产 dist 还缺 QuickJS WASM。Claude CLI 已修复 esbuild import.meta.url 与 WASM 交付；新增仓库外无祖先 node_modules 的 Node/Electron 真实 fetch/JSON/XPath/详情/聚合回归，先复现后通过，未停用沙箱边界。
* 经理已补充来源失败/空结果/未启用的区别、部分来源失败隔离、桌面 SQLite 浏览计数和排行、分类晚到请求隔离；排除四个内置演示来源的正式聚合，保留显式演示入口。Web 52 项、server 聚合 9 项和类型/lint 通过；完整 server 196 项在新增演示排除前通过，后续最终计数待重跑。
* 第二层联网问题：本机系统 DNS 将 api.bgm.tv 映射到 198.18.0.21，命中保留网段防护；普通直连 API 成功不代表沙箱可用。经理实测固定 Cloudflare HTTPS DNS 返回公网地址后，用同版本 undici.fetch+Agent 固定连接到验证地址，Bangumi 200 返回 7 日数据；global fetch 搭配 undici8 Agent 会报 invalid onRequestStart，需保持匹配。兼容实现进行中，不能把 ssrfun/cyfz 的硬编码演示内容当真实成功。
* Claude 接续网络任务触发会话额度（20:50 恢复），未修改网络实现；内部工程代理接续，agy 单次只读审查已启动。1.0.3 尚未打包/安装，当前 E 盘和用户收藏进度未修改。

* 后续实际升级还出现“Titanhub 无法关闭”：报错窗口存活时无 Titanhub.exe，仅 setup 与退出重试的 old-uninstaller.exe。此文案也用于旧卸载器非零退出，不能直接判断进程占用。
* 排查先误用了 Node fs.rename 的跨卷 EXDEV 推断 NSIS 行为，已撤回：同版本 NSIS 的真实 Rename 探针可以跨卷成功。NSIS 真实路径探针则复现源路径 241 字符可读、目标 337 字符失败、目标 236 字符成功；旧安装 E:/Titanhub 最长相对路径加临时备份前缀超过 MAX_PATH，才是本次升级失败的证据。
* 用户自行确认取消旧向导后，经理只为单次管理员安装进程设置 TEMP/TMP 为短路径 `E:/th-687a20`，未改系统环境。用户完成 1.0.1 安装并确认可打开；安装器退出码 0，E 盘 EXE 元信息与 HKLM 卸载记录均为 1.0.1，实际主进程运行于 E:/Titanhub。未手工删除安装目录、注册表或用户收藏进度。
* 1.0.2 已内置短临时目录处理：检测旧安装后建立受保护的短目录，仅设置当前进程 TEMP/TMP，完成后恢复，不跳过占用检查，不复用已存在目录；失败明确退出。之前按错误跨盘假设启动的委派已停止，其长 GUID 临时目录方案已替换。
* 经理独立验证 NSIS 3.0.4.1 的 10 项真实夹具（长路径失败回滚、短路径成功、环境恢复、无旧版、创建失败/回退、不复用目录、DACL）及 desktop 全部 51 项通过；类型检查与 lint 通过。测试工作目录改在盘根，避免 GitHub CI 的长仓库路径破坏源路径边界。完整 NSIS 安装包构建成功，1.0.2 产物 101362762 字节，SHA256 `8A30EA5057F9BF9779B4BB1DC67498F336F2FB5AB41179BB6474A041B3C64B03`。未对用户当前可用的 1.0.1 再执行安装；1.0.2 的真实 UAC 升级和干净系统生命周期仍待验收。agy 本轮只读审查超时，未计作通过。

* 用户安装到 `E:/Titanhub` 后启动失败，经理真实复现 `Cannot find module 'styled-jsx/package.json'`。Next 原始绝对 junction 在打包解引用后丢失依赖可见性；仓库内祖先 node_modules 和 pnpm 注入的 NODE_PATH 掩盖了缺包。先前“可以试用”的证据不足，旧 1.0.0 不再作为可用安装包交付。
* 1.0.1 已修复：prepare-standalone 按实际依赖可见性生成无链接的可搬移目录，保留不同版本依赖；构建配置改用此脚本，CI 增加 Web 测试。新增单元回归先复现同一 styled-jsx 错误再通过；仓库外中文/空格路径下清除 NODE_PATH/NODE_OPTIONS，Node 和 Electron 均通过首页、静态资源、设置和动态路由测试。GUI 烟测使用独立 profile/数据库，避免触碰用户资料。
* 经理最终执行 web 47 项、desktop 41 项全部通过；类型检查、Lint（Web 仅既有图片警告）和完整 `pnpm package:desktop` 通过。修正新增测试的 Lint 后，再跑仓库外 2 项回归与 desktop 类型检查通过。
* 从最终 NSIS EXE 直接解压到 C 盘根目录下中文/空格路径，再用其中真实 Titanhub.exe 跑完整 GUI 流程通过：来源安装/停启/卸载、收藏、四类进度退出重启、双隔离 profile WebDAV。此验证使用最终安装包文件，不依赖仓库父 node_modules；媒体/WebDAV 为受控夹具。未修改 E 盘现有安装及用户收藏进度；用户原目录实际覆盖安装仍待执行。
* 修复产物 `apps/desktop/build-out/Titanhub-Setup-1.0.1-x64.exe`，101361660 字节，SHA256 `AF95E438E9C762336AA5E21C07FC7CE2028B2218AE48B1DDE4510E37FCDD3449`；元信息 1.0.1.0，归档不含用户数据库/JWT 密钥/WebDAV 凭据。未提交、推送或公开发布。

* agy 故障已分层复现：遥测 PreToolUse 的 Windows 路径引号错误、headless 终端权限自动拒绝、服务端间歇地区限制（400）。原 hooks.json 备份在 `C:/Users/Tismi/AppData/Local/Temp/titanhub-agy-diagnose-6af292e01bf04a88aed32d77bf113bf5/hooks.original.json`；仅修正 Node 脚本路径，未禁用插件或更改账号/模型/全局权限。单次受限授权调用已真实执行目录查询并读取安装配置，agy 确认 NSIS 可选目录向导；未将静态审查冒充安装升级卸载实测。该账号不支持 auto 模式，后续 headless 命令需显式限定任务并给予单次授权；地区错误仍可能重现。
* Claude 完成 P2 首步纯 Dart 协议、共享 JSON 向量、两端测试。经理在临时目录下载并核对官方 SHA256 的 Dart 3.13.7 SDK（未改 PATH），新增无 Flutter 依赖的 `apps/mobile/tool/check_sync_protocol.dart`；实际 Dart 验证通过同一 96 组向量及 6 项字节/记录边界，模块和验证工具的 dart analyze 均无问题。server 最终 19 文件 188 项回归与 tsc 通过。Flutter widget 测试未运行，手机设置、Drift 迁移和手机 WebDAV 传输仍未接入。

* 重启后确认实现分支、既有修改及安装包均保留；重新调起 Claude CLI 修复来源管理本地鉴权与 PATCH 预检，agy 独立复核安装交付。
* 上轮真实 Electron GUI 验收最终通过：收藏重启保留、视频最后位置 4.25 秒、小说约 42% 滚动位置、漫画第 3 页；两个隔离资料目录通过设置页连接测试和 WebDAV 同步，本机凭据文件不含明文密码。媒体内容和 WebDAV 使用受控本地夹具，不能等同于真实 NAS 验收。
* 本轮先复现来源启停所需的 PATCH 未列入 CORS，Claude 完成修复；前端来源安装/启停/卸载统一使用已验证的本地能力与地址，保留浏览器云端模式。新增 3 项前端鉴权测试通过。
* 最终独立回归：server 18 文件 92 项、web 9 文件 45 项、desktop 8 文件 39 项全部通过，共 176 项；三个工作区类型检查、相关 Lint 和完整 `pnpm package:desktop` 通过，Lint 仅有既有图片警告。
* 新打包程序的真实 GUI 再验收通过：来源安装/PATCH 停启/卸载；影视 4.25 秒、动漫 2.75 秒、小说 42%、漫画第 3 页的退出重启恢复；双隔离资料目录通过实际设置界面的 WebDAV 连接测试与同步（4 类进度+收藏）。仅内容解析和 WebDAV 服务使用受控夹具，本地 API、SQLite、凭据加密、进程与界面为真实链路。
* 新安装包：`apps/desktop/build-out/Titanhub-Setup-1.0.0-x64.exe`，136703788 字节；SHA256 `32FD98B09B5CB21AAB1117567459D03D000AAEB55268D2B8DCD8B1EBDF989492`。归档检查未包含本机数据库、JWT 密钥或 WebDAV 凭据。未提交、推送或发布。干净 Windows 安装升级卸载、真实 NAS 和移动互通仍未验证/实施。
* agy 已实际调起：文件工具仍受遥测 Hook 路径错误影响；改为直接提供配置上下文后，服务又返回地区不支持（400）。经理接续最终复核，未将 agy 本轮复核计为通过。

## 2026-10-23：当前实现与验收状态

* Claude CLI 实际完成本地鉴权、SQLite 迁移及桌面会话后触发额度上限；内部代理接续前端数据队列、四类播放/阅读恢复和 Windows WebDAV。agy 实际提供 NSIS/CI/README 补丁及最终进度审查，Codex 负责整合与独立验收。
* P0 已实现：免注册本地收藏和进度、完整媒体复合键、失败可重试、退出前同步捕获最新进度并等待落盘，动漫/影视/漫画/小说位置恢复。
* Windows P1 已实现：统一快照与确定性合并、SQLite v4 同步状态、手动 WebDAV 及故障重试、safeStorage 凭据保存、设置页保存/测试/同步入口。密码不回显，变更地址或账号后必须重新输入密码。
* P-PACK 的 NSIS 安装 EXE 已实际构建成功；独立 Electron Windows CI 与安装说明已补齐。packaged 后端烟测已执行，但不能替代安装生命周期验收。
* 经理独立执行 server 回归、web 42 项测试和 desktop 39 项测试（含真实 packaged 烟测）。server 回归仍新增用例，最终总数以后续完整执行记录为准。
* 真实 Electron GUI 已验证收藏退出重启后保留，以及视频最后进度 4.25 秒。漫画/小说的实际 GUI 恢复、双 profile 的 UI WebDAV 流程仍在验收。
* 尚未完成：干净 Windows 实机安装、覆盖升级、卸载/重装及快捷方式验证；真实 NAS WebDAV 兼容性；P2 Flutter 协议对齐与桌面手机互通。未把这些项目标记为通过，也未公开发布。

## 2026-10-23：实施早期记录（历史）

* 用户明确要求往下执行。实现分支 `codex/windows-local-first`；原有 58 个已修改/未跟踪文件在临时目录完整快照备份，未覆盖此前工作。
* 运行目录：`C:/Users/Tismi/AppData/Local/Temp/titanhub-implementation-1e6decda1a1a4c6b8194c384b721169a`。Claude 终端会话 21063 执行 P0-A/B/C；agy 提供安装配置、CI、README 补丁，由经理逐项审查、修正格式并应用。
* 已实际修改桌面 NSIS 配置、根安装命令、Electron Windows CI 和 README。中间 NSIS 构建成功，约 136MB；它仅验证打包链路，待 P0 完成后必须全量重建。
* 经理发现并修复原配置禁用 EXE 资源编辑导致 ProductName 仍为 Electron 的问题；目录构建后元信息确认为 Titanhub 1.0.0。
* 经理独立运行 server 的 local-session/jwt 测试：2 文件、13 用例通过；local-data/sqlite 测试：2 文件、9 用例通过。公共 API 用临时 SQLite 真实启动后端验证收藏、来源隔离、重看及重启读回。
* 安装配置只读审查未发现确定阻断项；干净 Windows 的实际安装/升级/卸载尚未验证。P0 前端和桌面桥接仍由 Claude 实施，不能宣称整体完成。

## 2026-10-23：更新参考后的优先级与安装包要求（历史）

* 重新核对 Titanhub 桌面脚本及发布工作流，确认现有 dir/portable 与 Flutter ZIP 均不能作为最终安装向导交付。
* 用户明确最终 Windows 客户端需要安装包；设计新增 NSIS 安装 EXE，包含快捷方式、可选目录、内置运行时、覆盖升级及卸载重装保留资料要求。
* Claude 完成只读技术复核，agy 整理安装验收场景；经理补入 P-PACK 工单与 TC14-TC18，计划共 18 项待验收。
* 业务更新顺序保持本地免注册保存与恢复、桌面手动 WebDAV、移动互通；安装包构建/CI 与前期工作分范围尽早打通。
* 本轮只更新计划、设计和进度文档；没有构建、安装、卸载或发布产品，也没有修改打包配置和业务代码。

## 2026-10-23：免注册与 WebDAV 设计（历史）

* 用户确认先搁置注册登录服务，选择本地直接用、WebDAV 按需同步；本轮授权产出最小设计和验收用例。
* 创建 `codex/local-first-webdav-design` 分支，保留原有未提交修改；未提交、推送或修改产品代码。
* 终端调用 Claude 完成代码核对与两轮设计复核；agy 在无需文件工具的模式下整理验收矩阵。
* 落盘最小设计和分阶段实施计划，包含首张本地能力会话工单、正常退出写入确认、多源标识、重看恢复、删除墓碑及损坏远端停止策略。
* 本轮验收限于文档一致性、路径和 diff 检查；未执行功能测试或真实 WebDAV 兼容性测试。旧桌面测试基线不能当成本功能通过证据。

## 2026-07-17 会话：启动双轨运行优化
* 初始化任务规划文件。
* 在 `apps/mobile/pubspec.yaml` 中添加 `flutter_js` (JS 引擎) 和 `html` (HTML 解析) 依赖并成功拉取。
* 创建了 `apps/mobile/lib/core/sandbox/js_engine.dart` 并完整实现 Dart 侧与 JS 沙箱的 `fetch` 接口以及 Cheerio HTML 规则解析器（`select`, `selectOne`, `selectText`, `selectAttribute`）。
* 将全部的插件 JS 文件作为本地资产打包进 App 并在 `pubspec.yaml` 中声明，实现了 `local_plugin_runner.dart`。
* 重构了 `media_providers.dart` 中全部 8 个 FutureProvider，实现了自动识别本地插件与服务器下线时的无缝本地沙箱降级回退。
* 编写了根目录 `Dockerfile`，实现了全自动的 Hono 服务端多包依赖打包，并重构了 `docker-compose.yml`，现在可以通过单一指令 `docker compose up -d` 部署包含 PostgreSQL 数据库在内的完整后端公网环境。
