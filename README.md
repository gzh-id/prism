# Prism

> 零后端、隐私优先的前端可观测性工具。
>
> 第一次上手请看 **[docs/使用手册.md](./docs/使用手册.md)** —— 从「这到底是什么」到「每一步点哪里」都有写。
> 想完整理解这个项目（为什么做、怎么实现、面试怎么讲）看 **[docs/项目总览.md](./docs/项目总览.md)**。

一个 6.07KB 的零依赖采集 SDK + 一个纯本地运行的 React 分析看板。**数据全程不出浏览器**，存在 IndexedDB 里，需要分享时导出成一份压缩报告。

## 它解决什么问题

中小团队想给线上项目接前端监控，但卡在三个地方：

1. 商业 SaaS 要付费，且埋点数据要上传到第三方服务器，很多公司的安全评审过不了
2. 自建要搭一整套后端 + 存储 + 看板，投入产出比太低
3. 临时想排查某个问题时，装 SDK、配后台的周期比问题本身还长

Prism 的取舍是：**干脆不要后端。** 代价是丢失多用户聚合告警能力 —— 这是主动放弃的，不是没想到。

## 五分钟跑起来

**Windows 上最省事的方式：双击根目录的 `start-demo.cmd`** —— 它会自己检查构建、启动服务、并打开演示站点。

或者手动执行：

```bash
npm install     # 安装依赖
npm run build   # 构建 SDK 与看板
npm run serve   # 启动本地服务
```

然后：

1. 打开 <http://localhost:5173/apps/demo-site/>
2. 依次点几个按钮：抛 JS 错误、加载失败的图片、发一个慢请求
3. 点「打开看板查看」，就能看到错误列表（带操作面包屑）、LCP 趋势、资源瀑布图

> 两个页面必须在**同一个域名**下打开。IndexedDB 是按 origin 隔离的，
> 直接用 `file://` 打开的话 origin 是 null，两个页面读不到同一份数据。

## 一行接入

```html
<script src="./packages/core/dist/index.global.js"></script>
<script>
  Prism.init({
    release: '1.0.0',
    integrations: [
      Prism.errorsIntegration(),
      Prism.webVitalsIntegration(),
      Prism.networkIntegration(),
      Prism.breadcrumbsIntegration(),
    ],
  });
</script>
```

## 项目结构

```
packages/shared     事件类型定义 —— 全项目唯一真相来源
packages/core       @prism/core，零依赖采集内核
packages/cli        @prism/cli，source map 还原命令行工具
apps/dashboard      React 19 看板
apps/demo-site      故意留有各种问题的演示站点
scripts/            体积卡口 + 本地静态服务
```

## 核心实现（面试能讲的都在这些文件里）

| 文件 | 关键设计 |
|---|---|
| `core/src/ring-buffer.ts` | 定长环形缓冲，写入 O(1) 零内存分配。为什么不用数组 push+slice |
| `core/src/sampling.ts` | sessionId 哈希的**稳定采样**。为什么不能用 `Math.random`（会让行为轨迹断裂） |
| `core/src/sanitize.ts` | 丢弃而不是打码敏感参数。为什么打码仍可被反推 |
| `core/src/schedule.ts` | 空闲调度 + 页面隐藏时机。Safari 不支持 `requestIdleCallback` 的降级 |
| `core/src/integrations/errors.ts` | 资源加载失败的 error 事件**不冒泡**，只能在捕获阶段监听 |
| `core/src/integrations/webVitals.ts` | `buffered: true` 不能漏；每个 entryType 单独 try/catch |
| `core/src/integrations/network.ts` | 代理而非替换原生 fetch/XHR；绝不读响应体 |
| `core/src/storage/idb.ts` | 为什么选 IndexedDB 而不是 localStorage；容量淘汰 |
| `dashboard/src/VirtualList.tsx` | 手写变高行虚拟滚动：行高缓存 + 二分查找 + overscan |
| `dashboard/src/LineChart.tsx` | 手写 Canvas：devicePixelRatio 处理 + LTTB 降采样保峰值 |
| `dashboard/src/Waterfall.tsx` | 手写瀑布图：把「慢」拆成 DNS / TCP / SSL / 等待 / 下载 |

## 常用命令

```bash
npm run build           # 构建全部
npm run build:core      # 只构建 SDK
npm run build:dashboard # 只构建看板
npm test                # 单元测试（21 个）
npm run size            # 体积卡口（8KB 预算）
npm run serve           # 本地演示服务
npm run demo:assets     # 重新生成演示站点用的图片（零依赖手写 PNG 编码器）
npm run walkthrough     # 重新生成代码导览页 docs/代码导览.html
npm run walkthrough:check # 校验导览里的代码片段与源文件逐字符一致

node packages/cli/src/index.ts sourcemap packages/core/dist/index.global.js.map 1 3000
```

## 实测数字

| 产物 | 原始 | gzip | 8KB 预算占用 |
|---|---|---|---|
| ESM（现代工程） | 16.44 KB | **6.07 KB** | 75.8% |
| IIFE（一行 script） | 16.40 KB | **6.04 KB** | 75.5% |

单元测试 21 个全绿，覆盖环形缓冲、采样稳定性、脱敏、指标分档、报告压缩往返、会话聚合、上报时机收口。

## 单文件离线报告

看板右上角的「导出离线报告」会产出一个自包含 `.html`：JS、CSS、数据全部内联，**断网双击即可查看**，可以直接发给同事，全程不需要服务器。

实现是「模板 + 数据」两段式：

1. 构建时生成 `dist/report-template.html`，把看板运行时（含 React）内联进去，只留一个数据占位符
2. 导出时把压缩后的数据填进占位符，产出一个完整文件

实测：45 条事件的 JSON 为 14.8KB，gzip 压缩后 1.6KB（**省 89.4%**），最终 HTML 235KB。

想直接看效果，仓库根目录有一份生成好的 `sample-report.html`：

```bash
npm run sample   # 重新生成示例报告
```

## 已知局限

- **主动放弃**：多用户聚合与实时告警。零后端架构换来的代价，不是没想到
- sourcemap 里的 sources 路径基准有偏差，CLI 用多候选路径回退绕过了
- 尚未做 Playwright E2E
- Chrome 扩展（可外挂到任意第三方站点看瀑布图）还没做，在 Roadmap 里

## 工具链说明

构建用 **Rollup** 而不是 Vite/esbuild：本机环境装不上 esbuild 的原生二进制（postinstall 阶段 spawn 失败）。Rollup 是纯 JavaScript，没有这个问题，代价是构建慢一点。

测试同理，用 Node 内置 test runner 而不是 vitest（vitest → vite → esbuild）。

包管理器用 **npm workspaces**：pnpm 12 在本机有链接问题，非 scoped 包不会被链进 node_modules。
