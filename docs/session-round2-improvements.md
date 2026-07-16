# Titanhub 第二轮深度优化 — 三视角分析报告

> 执行时间：2026-07-16 | 应用技能：voices38-perspective, web-scraping-masters-perspective, awesome-design-md

---

## 1. 爬虫大师视角 — 插件引擎与采集架构

### 1.1 韧性缺陷修复

**重试机制**：沙箱 `fetch` 现在支持自动重试。遇到 429（Too Many Requests）或 503（Service Unavailable）时，按指数退避策略重试最多 2 次。尊重 `Retry-After` 响应头。

**响应缓存**：GET 请求的结果现在会被缓存 60 秒（TTL），最多 200 条。同一个漫画详情页在短时间内不会被反复请求——减少带宽消耗和目标服务器压力。

**请求超时**：每个 fetch 请求有 15 秒超时（`AbortController`）。之前一个挂起的请求会阻塞整个插件执行直到沙箱超时。

**响应大小限制**：响应体限制在 5MB 以内，防止恶意页面返回超大 payload 导致内存耗尽。

### 1.2 基础设施补齐

**通用限速**：所有域名默认 100ms 最小请求间隔。MangaDex 保持 250ms 专用限速。之前只有 MangaDex 有限速，其他站点可以无节制请求。

**并发安全**：限速逻辑从 `runMethod` 内联代码提取到独立的 `hardenedFetch` 函数，消除了重复代码，所有 fetch 路径统一走同一套安全+韧性管道。

### 1.3 嗅探器资源预算

PlaywrightSniffer 现在限制视口为 1280×720（减少渲染开销），并拦截图片/字体/CSS 请求（视频嗅探只需要 JS + 媒体流）。

---

## 2. Voices38 视角 — 安全与沙箱审计

### 2.1 DNS TOCTOU 竞态修复

**问题**：`isSafeUrl` 先做 DNS 查询验证 IP 不在内网，然后 `fetch` 再做实际请求。两次 DNS 之间有窗口——攻击者可用 DNS rebinding 实现内网访问。

**修复**：`hardenedFetch` 现在使用 `redirect: 'manual'` 手动跟随重定向。每一跳重定向都重新走 `isSafeUrl` 验证。最大重定向链长度限制为 5。

### 2.2 重定向 SSRF 防护

**问题**：`isSafeUrl` 只检查初始 URL，但 `fetch` 默认跟随重定向。一个 `302 → http://169.254.169.254/` 就能绕过整个 SSRF 防护。

**修复**：手动重定向模式下，每个 `Location` 响应头都经过 `isSafeUrl` 验证后才跟随。303 状态码自动切换为 GET 方法。

### 2.3 密码学 API 暴露面（已知，暂未收紧）

沙箱暴露了 AES 解密（ECB/CBC/CFB/OFB）、RSA 解密、HMAC、MD5、SHA1/256/512。这些 API 本意是让插件解密站点加密的参数，但同样可用于解密 DRM 内容。当前保持不变——这是功能需求与安全最小化之间的权衡，记录为已知风险。

---

## 3. Awesome Design MD 视角 — 前端设计系统升级

### 3.1 设计系统选型

采用 **Spotify + Linear 混合设计语言**：
- **Spotify**：内容优先的暗色哲学（`#08090a` 近黑背景），pill 几何按钮，重阴影表达深度，封面图作为色彩主角
- **Linear**：Inter 字体 + OpenType 特性（`cv01`, `ss03`），半透明白色边框（`rgba(255,255,255,0.08)`），亮度阶梯表达深度，weight 510 作为默认强调字重

### 3.2 主题 Tokens 升级

| 维度 | 改进前 | 改进后 |
|------|--------|--------|
| 颜色 | 9 个基础色 | 17 个语义化颜色（含 3 级边框、success/warning/danger） |
| 阴影 | 无 | 6 个阴影 token（card/cardHover/dialog/dropdown/insetBorder/focusRing） |
| 动画 | 3 个时长 | 3 时长 + 3 缓动函数（easeOut/easeInOut/easeSpring） |
| 圆角 | 5 个 | 7 个（新增 3xl=24px, pill=9999px） |
| 排版 | 无系统 | 13 级排版层级（displayXl→micro），含字重、行高、字间距 |
| 表面 | 2 级 | 4 级亮度阶梯（background→surface→surfaceLight→surfaceElevated） |

### 3.3 CSS 自定义属性

主题构建脚本现在生成 CSS 自定义属性（`--color-*`, `--shadow-*`, `--duration-*`, `--radius-*`, `--text-*`），供 `globals.css` 和组件直接引用。

### 3.4 组件升级

- **MediaCard**：实色边框 → 半透明边框（`borderSubtle`），pill badge 替代方角标签，`shadow-cardHover` 替代简单 hover，`loading="lazy"` 图片懒加载
- **HeroBanner**：`font-extrabold` → `font-bold` + 负字间距（Linear 风格），pill 按钮，glass-surface 玻璃态效果
- **首页**：搜索按钮使用 `glass-surface` + `rounded-pill`，间距收紧
- **搜索页**：表单从方角卡片 → pill 玻璃态搜索栏
- **设置页**：卡片圆角从 2xl → xl，边框从实色 → 半透明

### 3.5 globals.css

从一行 `@import 'tailwindcss'` 升级为完整设计系统入口：
- Inter 字体导入（Google Fonts，7 个字重）
- OpenType 特性（`cv01`, `ss03`）
- 自定义滚动条（Spotify 风格：细、暗、半透明）
- 选区高亮（品牌紫色）
- Focus ring 无障碍样式
- `glass-surface` / `surface-card` / `pill-badge` 工具类

---

## 4. 变更清单

| 文件 | 改动类型 | 内容 |
|------|----------|------|
| `server/src/plugins/sandbox.ts` | 安全+韧性 | 新增 `hardenedFetch`：超时、重试、缓存、大小限制、重定向验证、通用限速 |
| `server/src/plugins/sniffer.ts` | 资源预算 | 视口限制、资源类型拦截 |
| `packages/theme/src/tokens.json` | 设计系统 | 扩展为 5 维 token 体系（颜色/阴影/动画/圆角/排版） |
| `packages/theme/src/build.ts` | 构建 | 支持 shadows/typography/CSS 自定义属性生成 |
| `apps/web/src/app/globals.css` | 设计系统 | 完整设计入口：字体、OpenType、滚动条、工具类 |
| `apps/web/src/components/MediaCard.tsx` | UI 升级 | 半透明边框、pill badge、lazy loading |
| `apps/web/src/components/HeroBanner.tsx` | UI 升级 | Linear 排版、pill 按钮、glass-surface |
| `apps/web/src/app/page.tsx` | UI 升级 | glass-surface 搜索、间距优化 |
| `apps/web/src/app/search/page.tsx` | UI 升级 | pill 搜索栏、标签样式 |
| `apps/web/src/app/settings/page.tsx` | UI 升级 | 卡片圆角、边框、字重 |

---

## 5. 测试验证

- TypeScript 类型检查：Web 端 + 服务端均通过
- Vitest 全量测试：**42/42 通过**（8 个测试文件，3 个子工程）
- 主题构建：`ts-node src/build.ts` 成功输出 colors/shadows/typography/radii/CSS vars
