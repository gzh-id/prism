/**
 * 生成演示站点的 hero 图。
 *
 * 为什么要自己生成：演示站点原本引用 via.placeholder.com，
 * 国内网络经常加载不出来，第一次用的人会以为是 SDK 坏了。
 * 自己生成一张放本地，整个演示流程完全离线也能跑。
 *
 * 顺带这也是个「零依赖手写 PNG 编码器」的例子 —— 只用 node:zlib，
 * 自己拼 IHDR / IDAT / IEND 三个 chunk 和 CRC32 表。
 *
 * 用法：npm run demo:assets
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1200;
const H = 400;

/** CRC32 查表。PNG 每个 chunk 都带 CRC，必须自己算 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function buildPng(width, height, pixelFn) {
  const pixels = Buffer.alloc(width * height * 3);
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      pixels[cursor++] = r;
      pixels[cursor++] = g;
      pixels[cursor++] = b;
    }
  }

  // 滤波器选 Up（2）：每行减去上一行同位置的字节。
  // 渐变图案在纵向高度相似，差分后几乎全是 0 —— 实测比 None（0）小一半以上。
  const stride = width * 3;
  const raw = Buffer.alloc(height * (1 + stride));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 2;
    for (let i = 0; i < stride; i++) {
      const current = pixels[y * stride + i];
      const above = y === 0 ? 0 : pixels[(y - 1) * stride + i];
      raw[o++] = (current - above) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

let seed = 20261002;
function nextRandom() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

// 32x32 一块取同一个噪点值：既让 PNG 不至于被压得过小
// （瀑布图上还要看得见 download 段），又不至于撑爆仓库体积。
const noise = new Map();
function blockNoise(x, y) {
  const key = ((y >> 5) << 12) | (x >> 5);
  let v = noise.get(key);
  if (v === undefined) {
    v = (nextRandom() - 0.5) * 5;
    noise.set(key, v);
  }
  return v;
}

const png = buildPng(W, H, (x, y) => {
  // 对角线渐变：项目主色 绿 → 紫
  const t = (x / W) * 0.55 + (y / H) * 0.45;
  let r = 29 + (83 - 29) * t;
  let g = 158 + (74 - 158) * t;
  let b = 117 + (183 - 117) * t;

  // 中心同心波纹，呼应「棱镜折射」的含义
  const cx = W * 0.5;
  const cy = H * 0.5;
  const d = Math.sqrt((x - cx) ** 2 + ((y - cy) * 1.6) ** 2);
  const ripple = Math.sin(d / 26) * 0.5 + 0.5;
  const falloff = Math.max(0, 1 - d / (W * 0.42));
  const boost = ripple * falloff * 46;
  r += boost;
  g += boost * 1.1;
  b += boost * 0.8;

  const n = blockNoise(x, y);
  return [clamp(Math.round(r + n)), clamp(Math.round(g + n)), clamp(Math.round(b + n))];
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'apps', 'demo-site', 'assets');
mkdirSync(outDir, { recursive: true });

const outFile = join(outDir, 'hero-banner.png');
writeFileSync(outFile, png);
console.log(`已生成 ${outFile}（${(png.length / 1024).toFixed(1)} KB）`);
