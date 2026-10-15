# AGENTS.md — Prism 项目协作约定

> **放置位置**：Git 仓库根目录。
> Codex CLI 会自动读取；Cursor 在 `.cursorrules` 里写 `@AGENTS.md`；Claude Code 在 `CLAUDE.md` 里写 `@AGENTS.md`；WorkBuddy 在对话开头说一句「先读 AGENTS.md 再动手」。
> **作用**：每开一个新会话，AI 不需要你重新解释一遍项目。每个会话省 10 分钟，2-3 周里会开 40+ 个会话。

---

## 一句话定位

Prism 是一个**零后端、隐私优先**的前端可观测性工具：一个 < 8KB (gzip) 的零依赖 TS 采集 SDK，加一个纯本地运行的 React 分析看板，能把一次会话导出成单个自包含 HTML 文件。

**为什么存在**：中小团队用不起/不敢用 SaaS 监控（付费 + 数据出境合规），自建又要搭整套后端。Prism 的取舍是干脆不要后端。

---

## 硬约束（不可协商，违反即打回）

1. `packages/core` **运行时零第三方依赖**（devDependencies 不限）
2. 禁止引入 UI / 图表 / 虚拟列表库：echarts、d3、antd、react-window、ahooks 一律不许用。时间序列图、瀑布图、虚拟滚动必须手写
3. core gzip 后 **≤ 8KB**，用 `scripts/check-size.mjs` 卡口（`npm run size`），超了直接失败
4. `tsconfig` 开 `strict`，**禁止 `any`**（必要时用 `unknown` + 类型守卫并注释原因）
5. 看板技术栈固定 React 19 + TypeScript；**构建用 Rollup**（产出 ESM / CJS / IIFE 三产物）
6. 测试用 **Node 内置 test runner**（`node --test`），E2E 用 Playwright（阶段 6）
7. 注释与 UI 文案用**简体中文**；变量名、API 名用英文
8. **单文件改动不超过 300 行**，超过就拆成多步
9. **先给方案（含对比表）→ 我确认 → 再写代码**。禁止跳过方案直接写
10. 绝不记录请求体 / 响应体 / 完整 URL query 中的敏感参数（隐私是本项目的卖点）

### 工具链约束（踩过坑，别改回去）

- **包管理器用 npm workspaces，不用 pnpm**。本机 pnpm 12 有两个问题：esbuild 的 postinstall 因沙箱限制 spawn 失败（EBUSY），且安装后 rollup 未被链接进 `node_modules`，导致命令找不到。
- **构建用 Rollup，不用 tsup/vite**。这两个依赖 esbuild 的原生二进制，本机装不上。Rollup 是纯 JavaScript，无此问题。代价是构建慢一点，对 8KB 的库可忽略。
- **测试用 `node --test`，不用 vitest**。vitest 依赖 vite → 依赖 esbuild，同样装不上。
- 如果换到一台环境正常的机器，可以换回 vite/vitest，但要先确认 esbuild 二进制装得上。

---

## 目录结构

```
packages/core        @prism/core，零依赖采集内核        已建
packages/shared      事件类型定义，三方共用              已建
packages/cli         @prism/cli，source map 还原工具     已建
apps/dashboard       React 19 看板                       已建
apps/demo-site       故意留有性能问题的演示站点           已建
apps/extension       Chrome 扩展                         未建（可降级 Roadmap）
scripts/             体积卡口 / 本地静态服务              已建
docs/                架构决策、面试问答、简历文案          未建 ← 下一步重点
```

---

## 数据契约

**唯一真相来源**：`packages/shared/src/types.ts`。任何模块引用事件类型都必须从这里 import，不允许各自重新定义。

改动类型定义前必须先给我看 diff 并说明原因。类型一旦锁定，core 和 dashboard 才能并行开发。

已定义的类型：`PrismEventBase` / `ErrorEvent` / `PerformanceEvent` / `NetworkEvent` / `PrismEvent`（联合）/ `Breadcrumb` / `Session` / `Integration` / `PrismClient` / `PrismOptions` / `ResolvedOptions` / `PrismReport`。
已定义的常量与纯函数：`METRIC_THRESHOLDS`、`rateMetric`、`REPORT_VERSION`。

---

## 编码规范

- 每个模块顶部写一段中文注释：这个模块干什么、为什么这样设计、不这样会怎样
- 引入我没见过的 API 时，旁边加一行注释说明它的作用
- 函数优先小纯函数，方便单测
- 命名：`init` / `captureException` / `addBreadcrumb` / `flush` 是公开 API，不得改名
- 插件接口固定为 `{ name: string; setup(client: PrismClient): void }`
- Git commit message 用中文写清楚，每阶段结束提交一次

---

## 我见过你犯的错（动手前先读一遍）

1. 用 `Math.random()` 做采样 —— 必须用 sessionId 哈希，保证同一会话决策一致，否则时序断裂
2. `PerformanceObserver` 忘记 `buffered: true` —— 拿不到 SDK 加载前已经产生的条目
3. 采集代码不包 try/catch —— SDK 崩溃会拖垮宿主页面，这是最严重的错误
4. 顺手把请求体/响应体塞进事件里 —— 直接违反本项目的核心卖点
5. 虚拟滚动按固定行高实现 —— 必须支持变高行
6. Canvas 图表忘记处理 `devicePixelRatio` —— 高分屏上会糊
7. 一次性输出几百行的大文件 —— 我看不懂，也讲不清
8. 自作主张加我没要求的功能 —— 每加一个功能，就多一份讲不清的风险
9. 用 `any` 绕过类型错误 —— 用 `unknown` 加类型守卫
10. 推荐引入第三方库来"简化实现" —— 那些库正是我要手写、要在面试里讲的东西
11. 访问 `window` / `document` 不判空 —— SSR 和 Node 测试环境里会直接崩

---

## 已知待办（按优先级）

1. **`docs/` 完全空白** —— 面试问答、简历文案、架构决策都还没写。这是把项目变成 Offer 的关键一步，优先级最高
2. Playwright E2E 未做：需要断言「页面触发错误 → IndexedDB 中确实存在该事件」
3. Chrome 扩展未做（可外挂到任意第三方站点看瀑布图，演示冲击力最强）
4. `dist/index.d.ts` 里 `export * from '@prism/shared'` 指向私有包，发布 npm 前需要处理
5. Rollup 产出的 sourcemap 里 sources 路径基准不对（`../../../src/client.ts`），CLI 已用多候选路径回退绕过，但最好从构建侧修好

### 内联 JS 的两个坑（已在代码注释里标注，别再踩）

1. **必须转义 `</script>`**：内联脚本内容里一旦出现这个字面量，HTML 解析器会提前结束 script 块，整个报告白屏
2. **`String.replace` 的替换值必须写成函数**：替换字符串里的 `$&`、`$'` 是特殊替换模式。React 压缩代码里含这些序列，直接传字符串会让 HTML 片段被注入进 bundle 内部（表现为产物里莫名出现 `<script src="...">` 字面量）
3. **占位符要匹配完整赋值语句**：占位符片段会作为常量存在于打包后的 bundle 里，只匹配片段会误伤代码

---

## 当前进度

- [x] 阶段 0 数据契约设计（`packages/shared/src/types.ts`）
- [x] 阶段 1 monorepo 骨架与构建管线（npm workspaces + Rollup 三产物）
- [x] 阶段 2 四个采集插件（errors / webVitals / network / breadcrumbs）
- [x] 阶段 3 IndexedDB 存储层 + 报告压缩导出（数据侧）
- [x] 阶段 4 React 19 看板：手写虚拟滚动（变高行）+ Canvas 折线图（LTTB 降采样）+ 资源瀑布图
- [x] 阶段 5 source map 还原 CLI（含 sourcesContent 缺失时的磁盘回退）
- [x] 阶段 6 部分：demo-site 演示站点 + 本地静态服务 `npm run serve`
- [x] 单文件离线 HTML 报告（模板 + 数据两段式，实测压缩省 89.4%）
- [ ] **阶段 6 剩余：`docs/` 文档交付**（面试问答 + 简历文案）—— 优先级最高
- [ ] Playwright E2E
- [ ] Chrome 扩展

**验收数字（会写进简历，别改坏；以下为实测值，改代码后跑 `npm run size` / `npm test` 复核）**
- core gzip **6.05 KB**，占 8KB 预算 75.7%
- 单元测试 **17 个全绿**
- 构建零警告，同时产出 ESM / CJS / IIFE

**上报时机收口设计（阶段 4 后补充，面试常问）**
- 页面隐藏 / 卸载时由 `client.finalize()` 统一收口：先调用各插件的 `beforeFlush`（把内部缓冲如 Web Vitals 累计指标刷进队列），再 `drain` 给 transport。
- 插件不再各自监听 `pagehide`，因此不依赖 DOM 事件注册顺序；早期版本曾因顺序问题静默丢失最后一批指标。

**当前所在阶段**：（每次会话开始写上）
**本次会话要完成**：（一句话）

---

## 关于我本人（影响你的输出方式）

我是 2027 届软件工程本科生，前端入门到中级水平，这个项目要拿去面试。

所以：**凡是我不可能理解的代码，等于没写。** 每一处关键设计，你都要能让我在不查资料的情况下讲清楚「它解决什么问题、为什么这么写、不这么写会怎样」。

每完成一个模块，主动在 `docs/面试题答案.md` 里补 2-3 道对应的问答。
