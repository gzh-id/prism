/**
 * 体积卡口 —— 防止 SDK 在一次次加功能中悄悄变胖
 *
 * 为什么要单独写这个脚本而不是用现成工具：
 * 8KB 是本项目对外承诺的硬指标，必须每次构建都能被验证。
 * 用 zlib 直接算 gzip 后大小，零依赖、几毫秒跑完，也不需要额外的打包器。
 *
 * 为什么看 gzip 而不是原始大小：
 * 线上传输的是 gzip 后的内容，用户感知到的成本就是它。
 * 用原始大小做卡口会高估近 3 倍，反而逼着自己砍掉本可以保留的功能。
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 硬性预算：gzip 后 8KB */
const LIMIT_BYTES = 8 * 1024;

const targets = [
  { name: 'ESM · 现代工程引入', file: 'packages/core/dist/index.js' },
  { name: 'IIFE · 一行 script 接入', file: 'packages/core/dist/index.global.js' },
];

function human(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

let failed = false;

console.log(`\n体积检查 · 预算 ${human(LIMIT_BYTES)} (gzip)\n`);

for (const target of targets) {
  const abs = resolve(root, target.file);
  if (!existsSync(abs)) {
    console.log(`  [缺失] ${target.name} — 请先执行 npm run build`);
    failed = true;
    continue;
  }

  const raw = statSync(abs).size;
  const gz = gzipSync(readFileSync(abs), { level: 9 }).length;
  const used = ((gz / LIMIT_BYTES) * 100).toFixed(1);
  const ok = gz <= LIMIT_BYTES;
  if (!ok) failed = true;

  console.log(
    `  ${ok ? '通过' : '超预算'}  ${target.name}\n` +
      `        原始 ${human(raw)} → gzip ${human(gz)}（用掉预算 ${used}%）`,
  );
}

if (failed) {
  console.error('\n体积卡口未通过。要么砍功能，要么回来调整预算并说明理由。\n');
  process.exit(1);
}

console.log('\n体积卡口通过。\n');
