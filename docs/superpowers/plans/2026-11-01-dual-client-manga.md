# 双端漫画与手机分类搜索实施计划

目标：修复真实电脑漫画错误，补齐用户要求的手机分类搜索，验证WebDAV跨端进度读取。延续已批准1.1.0手机独立架构。

实现边界：桌面来源过滤不可图片阅读的外链/0页章节；卡片复用SmartImage。手机分类状态独立于来源开关，按type过滤搜索，远程回退保持同类型。协议继续使用既有身份三元组和WebDAV设备代际格式，不按作品名称合并。

- [x] 隔离桌面真实复现首页封面失败与外链章节阅读失败。
- [x] 回归先红后绿，Web127、server302及Web类型检查通过；图片请求头/安全转发27项通过。
- [x] 更新桌面构建后实际验证首页图片与可读章节，中文第1话前4图已出图。
- [x] 手机全部/动漫/漫画/小说/影视筛选及无来源提示，provider与Widget回归及Android16/16KB release GUI通过。
- [x] Dart与TypeScript真实DAV交换再验；实际Android16/16KB GUI与桌面GUI已双向验证第8页/第9页。手机硬件GUI跨端续读尚未重测。
- [x] 修复图片高度变化导致续读页退一页，动态图片尺寸回归先红后绿；全量手机245项通过/1个可选协议互通跳过，该协议本轮已另跑真实HTTP通过。analyze/正式preview6 APK通过，保留旧包与用户数据。
- [x] 记录交付包、版本、签名、hash及尚未验证来源限制：
  - Windows `1.1.0`：`apps/desktop/build-out/Titanhub-Setup-1.1.0-x64.exe`（同步更新至 `build-out-1.1.0/`），`104,333,939` 字节，SHA256 `D67796E9EC9161A9D66B0466941AC5F50DF65ED1D98E939FB093C5E3D69835A8`（NSIS x64，未配商业 Authenticode 证书）。
  - Android `1.1.0+13`：`apps/mobile/release/Titanhub-1.1.0-universal.apk`，`118,921,028` 字节，SHA256 `2CF76AD5B8847039D361808FE3D89606C14E02D2E7CA1A06BA1A223560E9A041`（APK Signature Scheme v2，Android Debug 测试证书签名，REA `inspect-apk-signature` 校验 `self_consistent: true`）。
- [x] 动漫搜索/详情/线路已验证，5秒网络超时修为20秒后实际流14秒打开，时长24:53与时间推进通过；针对模拟器软件/宿主GPU `EGL_BAD_ATTRIBUTE`（`Could not create a GL context`）黑屏问题，已对标 Kazumi 接入 `vo=mediacodec_embed` + `hwdec=mediacodec` 自动回退与手动渲染模式切换按钮。真机硬件出画待 USB 设备回归。

参考：Venera network/images.dart按来源绑定图片请求配置与缓存；Mangayomi reader_prefetch_mixin.dart限制预加载会话并在dispose清理。本轮复用已有图片加载机制，不引入全章无限预取或跨来源身份猜测。
