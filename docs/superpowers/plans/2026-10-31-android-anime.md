# Android 独立动漫播放 Implementation Plan

**Goal:** 手机独立完成真实动漫搜索、分线选集、播放、续播和同线路下一集。

**Architecture:** 继续用户批准的Flutter本机来源架构，首个7sefun来源用已有Dio/html执行；播放页经Android WebView识别媒体后交media_kit。保留本地数据库与WebDAV协议，旧漫画/资料源契约兼容。

**Tech Stack:** Flutter/Riverpod/Dio/html/media_kit/Android WebView。

## 任务

- [已落地] dsh：SevenSeFunSource/runner/注册与HTML夹具；主管修正跨线相同ID不能全局去重。多次在线超时，headless探索超范围后停止，未取得规范最终报告。
- [已落地] Claude：headers/type、线路别名、可取消WebView；主管补video provider实际解析与autoDispose取消，新增provider集成测试。
- [已落地] Claude：分线/100集分段、自然排序/同线下一集、播放器请求头/自动播放/续播/错误重试/全屏。
- [已完成] agy：Kazumi触屏选集/末集边界参考清单；报告不当作实际播放验收。
- [进行中] Codex：实网样本与集成已完成，226项通过/可选interop跳过1，无analyze错误警告；1.1.0+3 release与真机真实画面/时间推进/续播待验证。

## 检查点

1. 真实来源不是示例片；客户端网络失败和空结果区分，禁止宽松绕过TLS/代理/挑战。
2. 桌面adapter实际字段为lineId/lineName；手机如采用groupId/groupName，fromJson必须兼容桌面字段，且每条线路稳定身份。
3. 不按同名跨源或按集号跨线合并；旧进度找不到唯一线路时不猜下一集。
4. WebView不开放敏感权限/文件访问/任意JS原生桥，媒体地址保留签名query，请求头传递到原生播放器。当前不加CORS代理。
5. 不能只取到播放地址就报成功；实际媒体需出画且时间推进。真实网盘不参与此次验证，保留真机双应用配置/已有漫画进度。
