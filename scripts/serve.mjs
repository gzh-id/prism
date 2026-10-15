/**
 * 极简静态服务器 —— 只为本地演示用
 *
 * 为什么必须有它：IndexedDB 是按 origin 隔离的。
 * 直接用 file:// 打开页面时 origin 是 null，演示站点和看板读不到同一份数据，
 * 演示流程会断。必须让两个页面跑在同一个 http://localhost 下。
 *
 * 另外它还负责把 /api/slow-report 延迟 1.2 秒再返回，
 * 用来在瀑布图上造出一个肉眼可见的慢请求。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);

  // 造慢请求：延迟 1.2 秒，让瀑布图上出现一条明显的长条
  if (url.pathname.startsWith('/api/slow-report')) {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, delayed: 1200 }));
    }, 1200);
    return;
  }

  try {
    // normalize + 前缀校验，防止 ../ 穿越到项目目录之外
    const requested = normalize(decodeURIComponent(url.pathname));
    const filePath = join(root, requested);
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(filePath);
    const target = info.isDirectory() ? join(filePath, 'index.html') : filePath;
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    // 404 也延迟一点，让「资源加载失败」在瀑布图上可见
    setTimeout(() => {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }, 300);
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    // 最常见的场景：已经开着一个服务窗口，又双击了一次启动脚本。
    // 这时不是出错，直接告诉对方「已经在跑了」比抛一堆栈有用得多。
    console.log(`\n  端口 ${port} 已被占用 —— 服务很可能已经在运行了。`);
    console.log(`  直接打开 http://localhost:${port}/apps/demo-site/ 试试。`);
    console.log(`  想换个端口：set PORT=5174 && npm run serve\n`);
    process.exit(1);
  }
  console.error('服务启动失败：', error);
  process.exit(1);
});

server.listen(port, () => {
  console.log(`\n  Prism 本地服务已启动\n`);
  console.log(`  演示站点  http://localhost:${port}/apps/demo-site/`);
  console.log(`  看板      http://localhost:${port}/apps/dashboard/dist/\n`);
  console.log(`  先打开演示站点点几下按钮，再打开看板。\n`);
});
