#!/usr/bin/env node
/**
 * 代码导览的校验脚本
 *
 * 这份导览的代码片段是从源文件按行号抽出来的 —— 好处是永远不会和源码脱节，
 * 风险是行号写错或者源文件改动后会静默错位（页面照样能打开，只是讲错了代码）。
 * 这个脚本就是来堵这个风险的：把生成结果里的代码抠出来，
 * 和「按同样的行号区间重新读一遍源文件」的结果做逐字符比对。
 *
 * 用法：node scripts/check-walkthrough.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import corePages from './walkthrough/data-core.mjs';
import pluginPages from './walkthrough/data-plugins.mjs';
import dashboardPages from './walkthrough/data-dashboard.mjs';
import engineeringPages from './walkthrough/data-engineering.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pages = [...corePages, ...pluginPages, ...dashboardPages, ...engineeringPages];

const htmlPath = resolve(root, 'docs/代码导览.html');
if (!existsSync(htmlPath)) {
  console.error('找不到 docs/代码导览.html，先执行：node scripts/make-walkthrough.mjs');
  process.exit(1);
}
const html = readFileSync(htmlPath, 'utf-8');

/* ---------------------------------------------------------- 从产物里抠代码 */

const rawBlocks = [...html.matchAll(/<div class="code-body">([\s\S]*?)<\/div>\s*<\/div>/g)].map(
  (m) => m[1],
);

if (rawBlocks.length === 0) {
  console.error('一个代码块都没抠出来 —— 生成器的输出结构可能变了，检查匹配规则。');
  process.exit(1);
}

function stripTags(lineHtml) {
  return lineHtml
    // 先去掉行号那一格（class="lg"）
    .replace(/<span class="lg">[^<]*<\/span>/, '')
    // 其余全部 span（注意 class="lc" 是两个字符，不能用 [a-z] 匹配）
    .replace(/<\/?span[^>]*>/g, '')
    // 行尾的容器闭合标签
    .replace(/<\/div>/g, '')
    // 反转义。顺序不能颠倒：先还原 &lt;/&gt;，最后才还原 &amp;，
    // 否则会凭空造出新的实体
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const rendered = rawBlocks.map((block) =>
  block
    .split('<div class="lin')
    .slice(1)
    .map((chunk) => {
      // 每个 lin 的前半段是行号 span，跳过它
      const afterLineNo = chunk.slice(chunk.indexOf('</span>') + '</span>'.length);
      return stripTags(afterLineNo);
    }),
);

/* ---------------------------------------------------------- 按数据重算一遍 */

const expected = [];
const problems = [];

for (const page of pages) {
  for (const block of page.blocks ?? []) {
    if (!block.code) continue;

    const abs = resolve(root, page.file);
    if (!existsSync(abs)) {
      problems.push(`${page.id}: 源文件不存在 ${page.file}`);
      continue;
    }
    const lines = readFileSync(abs, 'utf-8').split('\n');

    const out = [];
    block.code.forEach((range, index) => {
      const [from, to] = range;
      if (index > 0) out.push('⋯');
      if (from < 1 || to > lines.length) {
        problems.push(
          `${page.id}: 行号越界 ${page.file} 第 ${from}–${to} 行（该文件共 ${lines.length} 行）`,
        );
      }
      for (let n = from; n <= to && n <= lines.length; n += 1) out.push(lines[n - 1]);
    });
    expected.push(out);
  }
}

/* ---------------------------------------------------------- 比对 */

let mismatch = 0;
for (let i = 0; i < expected.length; i += 1) {
  const got = (rendered[i] ?? []).join('\n').replace(/\u00a0/g, ' ');
  const want = expected[i].join('\n');
  if (got !== want) {
    mismatch += 1;
    if (mismatch <= 3) {
      problems.push(`第 ${i + 1} 个代码块与源文件不一致`);
    }
  }
}

/* ---------------------------------------------------------- 结构自检 */

const opens = (html.match(/<span\b/g) ?? []).length;
const closes = (html.match(/<\/span>/g) ?? []).length;
if (opens !== closes) problems.push(`span 标签不平衡：${opens} 开 / ${closes} 关`);

const sections = (html.match(/<section class="page"/g) ?? []).length;
const navItems = (html.match(/class="nav-i"/g) ?? []).length;

/* ---------------------------------------------------------- 报告 */

console.log('');
console.log('代码导览校验');
console.log('');
console.log(`  页面数      ${sections}`);
console.log(`  导航项      ${navItems}`);
console.log(`  代码块      ${expected.length}`);
console.log(`  逐字符比对  ${expected.length - mismatch} / ${expected.length} 一致`);

if (problems.length > 0) {
  console.log('');
  console.log('  发现问题：');
  for (const p of problems) console.log(`    · ${p}`);
  console.log('');
  process.exit(1);
}

console.log('');
console.log('  全部通过。');
console.log('');
