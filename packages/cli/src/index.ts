#!/usr/bin/env node
/**
 * Prism CLI —— 把压缩后的堆栈还原成源码位置
 *
 * 为什么把这个功能做成命令行工具而不是放在 SDK 里：
 * 1. source map 通常有几百 KB 甚至几 MB，塞进浏览器会让 SDK 体积爆掉，
 *    直接违反 8KB 的预算。它是构建期的资产，不该出现在运行时。
 * 2. 还原需要读本地文件系统，浏览器做不到。
 * 3. 真实项目里这也是标准做法：构建时上传 map，出问题时在服务端或本地还原。
 *
 * 用法：
 *   prism sourcemap <map文件> <行号> <列号>
 *
 * 注意这个包是 Node 工具，可以有第三方依赖（source-map）；
 * 项目里「零依赖」的承诺只针对发布到浏览器的 @prism/core。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SourceMapConsumer } from 'source-map';

const HELP = `
Prism CLI

  prism sourcemap <map文件> <行号> <列号>
    把压缩代码的位置还原成源码位置，并打印上下各 3 行源码。

  示例：
    prism sourcemap dist/index.global.js.map 1 4521
`;

/**
 * 取源码内容，优先用 map 里内嵌的 sourcesContent，没有就回退读磁盘。
 *
 * 为什么要回退：很多构建配置（压缩插件、CI 产物精简）会把 sourcesContent 剥掉，
 * 只保留映射关系。这时候只要源码还在本地仓库里，照样能还原出上下文 ——
 * 本地排查时这个回退非常有用，省得为了看一眼出错行去改构建配置。
 */
function resolveSourceContent(
  mapPath: string,
  source: string,
  embedded: string | null | undefined,
): string | null {
  if (embedded) return embedded;

  const mapDir = dirname(mapPath);
  // map 里的 sources 常带 ../../ 这类相对前缀，而不同构建工具算这个前缀的基准不一样
  // （有的按 output 目录算，有的按项目根算），直接 resolve 经常对不上。
  // 所以除了原样拼，再按文件名去几个常见的源码目录里找一遍。
  const fileName = source.split(/[\\/]/).pop() ?? source;
  const candidates = [
    resolve(mapDir, source),
    resolve(process.cwd(), source),
    resolve(mapDir, fileName),
    resolve(mapDir, '..', fileName),
    resolve(mapDir, '..', 'src', fileName),
    resolve(mapDir, '..', '..', 'src', fileName),
    resolve(process.cwd(), 'src', fileName),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return readFileSync(candidate, 'utf-8');
    } catch {
      // 继续试下一个候选路径
    }
  }
  return null;
}

/** 打印源码上下文，帮助你一眼看出是哪一行出了问题 */
function printContext(sourcesContent: string | null, line: number, column: number): void {
  if (!sourcesContent) {
    console.log('\n（map 文件里没有 sourcesContent，无法展示源码上下文）');
    console.log('构建时加上 sourcemap: true 且不要把 sourcesContent 清掉即可。');
    return;
  }

  const lines = sourcesContent.split('\n');
  const from = Math.max(1, line - 3);
  const to = Math.min(lines.length, line + 3);

  console.log('');
  for (let i = from; i <= to; i += 1) {
    const marker = i === line ? '>' : ' ';
    const text = lines[i - 1] ?? '';
    console.log(`${marker} ${String(i).padStart(4)} | ${text}`);
    if (i === line) {
      // 在出错那一列下面打一个箭头，精确定位到列
      console.log(`      | ${' '.repeat(Math.max(0, column))}^`);
    }
  }
}

async function main(): Promise<void> {
  const [command, mapArg, lineArg, columnArg] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  if (command !== 'sourcemap') {
    console.error(`未知命令：${command}`);
    console.log(HELP);
    process.exit(1);
  }

  if (!mapArg || !lineArg || !columnArg) {
    console.error('参数不完整。');
    console.log(HELP);
    process.exit(1);
  }

  const mapPath = resolve(process.cwd(), mapArg);
  if (!existsSync(mapPath)) {
    console.error(`找不到 map 文件：${mapPath}`);
    console.error('提示：先执行 npm run build 生成 sourcemap。');
    process.exit(1);
  }

  const line = Number(lineArg);
  const column = Number(columnArg);
  if (!Number.isFinite(line) || !Number.isFinite(column)) {
    console.error('行号和列号必须是数字');
    process.exit(1);
  }

  const raw = readFileSync(mapPath, 'utf-8');
  const mapJson = JSON.parse(raw) as { sources?: string[] };

  // SourceMapConsumer 是异步构造的，它在内部建立二分查找索引
  const consumer = await new SourceMapConsumer(JSON.parse(raw));

  // 必须在 destroy 之前把 sourcesContent 取出来。
  // destroy 会释放内部引用，之后再访问就是 undefined —— 这个顺序坑了我一次。
  const allContent =
    (consumer as unknown as { sourcesContent?: Array<string | null> }).sourcesContent ?? [];
  const position = consumer.originalPositionFor({ line, column });
  consumer.destroy();

  if (position.source === null) {
    console.log(`\n无法还原：位置 ${line}:${column} 在 source map 里没有对应记录。`);
    console.log('常见原因：这一行来自第三方代码，或者构建时没有把这段代码纳入 map。');
    return;
  }

  console.log('\n还原结果');
  console.log(`  源码文件  ${position.source}`);
  console.log(`  源码位置  ${position.line}:${position.column}`);
  if (position.name) {
    console.log(`  标识符    ${position.name}`);
  }

  const sourceIndex = mapJson.sources?.indexOf(position.source) ?? -1;
  const content = resolveSourceContent(mapPath, position.source, allContent[sourceIndex]);
  printContext(content, position.line ?? 0, position.column ?? 0);
  console.log('');
}

main().catch((error: unknown) => {
  console.error('执行失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
