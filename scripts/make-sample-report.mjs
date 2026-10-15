/**
 * 生成一份示例离线报告（sample-report.html）
 *
 * 目的有两个：
 * 1. 端到端验证「模板 + 数据 = 一个能打开的文件」这条链路真的通
 * 2. 产出一个可以直接发给别人看的样例，演示时不用先手动点一堆按钮
 *
 * 这个脚本刻意不走 IndexedDB，而是自己造数据后走与运行时完全相同的
 * 压缩 → Base64 → 注入模板流程，所以它能验证真实路径。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, compressString, toBase64 } from '../packages/core/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BASE = {
  sessionId: 'demo-session-1',
  release: 'demo-1.0.0',
  environment: 'demo',
  url: 'https://shop.example.com/checkout',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
};

const now = Date.now();
const MINUTE = 60_000;

const events = [
  {
    ...BASE,
    id: 'e1',
    type: 'error',
    timestamp: now - 8 * MINUTE,
    kind: 'js',
    severity: 'error',
    message: "Cannot read properties of null (reading 'name')",
    stack:
      "TypeError: Cannot read properties of null (reading 'name')\n    at renderUser (app.js:1:4821)\n    at Checkout.render (app.js:1:9120)",
    breadcrumbs: [
      { timestamp: now - 9 * MINUTE, category: 'lifecycle', level: 'info', message: '页面加载完成' },
      { timestamp: now - 8.6 * MINUTE, category: 'click', level: 'info', message: '点击 button#submit' },
      { timestamp: now - 8.3 * MINUTE, category: 'network', level: 'info', message: 'POST /api/order 返回 502' },
      { timestamp: now - 8.1 * MINUTE, category: 'click', level: 'info', message: '点击 button#submit' },
    ],
  },
  {
    ...BASE,
    id: 'e2',
    type: 'error',
    timestamp: now - 6 * MINUTE,
    kind: 'resource',
    severity: 'warning',
    message: '资源加载失败：img /static/hero-banner.png',
    breadcrumbs: [
      { timestamp: now - 6.4 * MINUTE, category: 'navigation', level: 'info', message: '前进到 /checkout' },
    ],
  },
  {
    ...BASE,
    id: 'e3',
    type: 'error',
    timestamp: now - 4 * MINUTE,
    kind: 'unhandledrejection',
    severity: 'error',
    message: '异步任务失败了：订单状态同步超时',
    breadcrumbs: [],
  },
  {
    ...BASE,
    id: 'e4',
    type: 'error',
    timestamp: now - 2 * MINUTE,
    kind: 'blank-screen',
    severity: 'fatal',
    message: '页面疑似白屏：等待结束后仍未渲染出可见内容',
    breadcrumbs: [
      { timestamp: now - 2.5 * MINUTE, category: 'navigation', level: 'info', message: '前进到 /pay' },
    ],
  },
];

// 性能指标：造 12 个采样点，让趋势图有形状
for (let i = 0; i < 12; i += 1) {
  events.push({
    ...BASE,
    id: `p-lcp-${i}`,
    type: 'performance',
    timestamp: now - (12 - i) * MINUTE,
    name: 'LCP',
    value: 1800 + Math.round(Math.sin(i / 2) * 700) + i * 90,
    rating: 'needs-improvement',
  });
  events.push({
    ...BASE,
    id: `p-cls-${i}`,
    type: 'performance',
    timestamp: now - (12 - i) * MINUTE,
    name: 'CLS',
    value: Number((0.05 + Math.abs(Math.sin(i / 3)) * 0.22).toFixed(3)),
    rating: 'poor',
  });
  events.push({
    ...BASE,
    id: `p-inp-${i}`,
    type: 'performance',
    timestamp: now - (12 - i) * MINUTE,
    name: 'INP',
    value: 120 + Math.round(Math.abs(Math.cos(i / 2)) * 260),
    rating: 'needs-improvement',
  });
}

// 网络请求：带阶段耗时，让瀑布图有东西可画
const requests = [
  { url: 'https://shop.example.com/api/order', method: 'POST', status: 502, duration: 2310, dns: 42, tcp: 88, ssl: 130, ttfb: 1900, download: 150 },
  { url: 'https://cdn.example.com/hero-banner.png', method: 'GET', status: 200, duration: 1480, dns: 12, tcp: 30, ssl: 44, ttfb: 120, download: 1274 },
  { url: 'https://shop.example.com/api/user?token=xxx', method: 'GET', status: 200, duration: 260, dns: 0, tcp: 0, ssl: 0, ttfb: 180, download: 80 },
  { url: 'https://cdn.example.com/app.js', method: 'GET', status: 200, duration: 640, dns: 8, tcp: 22, ssl: 36, ttfb: 90, download: 484 },
  { url: 'https://analytics.example.com/collect', method: 'POST', status: 0, duration: 3020, dns: 60, tcp: 95, ssl: 140, ttfb: 2600, download: 125 },
];

requests.forEach((request, index) => {
  events.push({
    ...BASE,
    id: `n-${index}`,
    type: 'network',
    timestamp: now - (6 - index) * 30_000,
    url: request.url,
    method: request.method,
    status: request.status,
    duration: request.duration,
    transferSize: 0,
    ok: request.status >= 200 && request.status < 400,
    timing: {
      dns: request.dns,
      tcp: request.tcp,
      ssl: request.ssl,
      ttfb: request.ttfb,
      download: request.download,
    },
  });
});

const json = JSON.stringify(buildReport(events));
const compressed = await compressString(json);
const payload = toBase64(compressed);

const templatePath = resolve(root, 'apps/dashboard/dist/report-template.html');
const template = readFileSync(templatePath, 'utf-8');
/**
 * 必须匹配完整的赋值语句：占位符片段同时作为常量存在于打包后的 bundle 里，
 * 只匹配片段会误伤 bundle 内部代码。
 */
const PLACEHOLDER = 'window.__PRISM_PAYLOAD__=/*__PRISM_DATA__*/null';

if (!template.includes(PLACEHOLDER)) {
  console.error('模板里找不到数据占位符，请先执行 npm run build');
  process.exit(1);
}

const html = template.replace(
  PLACEHOLDER,
  () => `window.__PRISM_PAYLOAD__=${JSON.stringify(payload)}`,
);
const outPath = resolve(root, 'sample-report.html');
writeFileSync(outPath, html, 'utf-8');

const ratio = ((1 - compressed.length / json.length) * 100).toFixed(1);
console.log(`\n已生成 ${outPath}`);
console.log(`  事件 ${events.length} 条 · JSON ${(json.length / 1024).toFixed(1)}KB`);
console.log(`  压缩后 ${(compressed.length / 1024).toFixed(1)}KB（省了 ${ratio}%）`);
console.log(`  最终 HTML ${(html.length / 1024).toFixed(0)}KB\n`);
