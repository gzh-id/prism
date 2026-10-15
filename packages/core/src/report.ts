import type { PrismEvent, PrismReport, Session } from '@prism/shared';
import { REPORT_VERSION } from '@prism/shared';
import { readAllEvents } from './storage/idb';

/**
 * 报告导出 —— 「单文件离线 HTML」这个杀手锢的数据准备部分
 *
 * 完整流程是：读出事件 → 压缩 → 编码成字符串 → 嵌进 dashboard 的 HTML 里。
 * 这里负责前三步，最后一步要等看板构建产物就绪后接上。
 *
 * 为什么必须压缩：
 * 一份真实站点的监控数据轻松上 MB，直接内嵌会让 HTML 文件大到发不出去。
 * 实测 JSON 压缩后通常只剩 5%~15%，这是这个功能能不能用的分水岭。
 */

/**
 * 用原生 CompressionStream 做 gzip。
 * 选原生 API 而不是引入 pako/lz-string，是因为它是零依赖、浏览器和 Node 都自带，
 * 符合本项目「零第三方依赖」的承诺。
 */
export async function compressString(text: string): Promise<Uint8Array> {
  // 不支持时原样返回字节，宁可文件大一点也不能导出失败
  if (typeof CompressionStream === 'undefined') {
    return new TextEncoder().encode(text);
  }

  const source = new TextEncoder().encode(text).buffer as ArrayBuffer;
  const stream = new Blob([source]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** 解压缩，导入报告时用 */
export async function decompressString(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  // TypeScript 5.9 起 Uint8Array 底层的 buffer 可能是 SharedArrayBuffer，
  // 直接塞进 Blob 会类型不兼容。复制一份拿到确定的 ArrayBuffer，
  // 顺带避免了调用方复用同一块内存导致的隐式改动。
  const copy = new Uint8Array(bytes).buffer as ArrayBuffer;
  const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * 字节流转 Base64，才能安全地塞进 HTML 文本里。
 * 分块处理是因为 String.fromCharCode 一次吃不下太大的数组（会爆调用栈）。
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Base64 还原成字节流 */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 解码导出 payload：优先按 gzip 解；若解出来的不是合法 JSON（典型场景是：
 * 报告在「支持 CompressionStream」的环境导出，却在一个「不支持」的环境导入），
 * 则退回把原始字节当未压缩文本解。这样跨环境导入不会直接崩。
 */
async function decodePayload(bytes: Uint8Array): Promise<string> {
  try {
    const decompressed = await decompressString(bytes);
    // 试解析，失败说明其实不是压缩产物，走下方 fallback
    JSON.parse(decompressed);
    return decompressed;
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** 导出体积上限（原始 JSON 字节）。超过就明确报错，避免生成一个打不开的巨文件 */
const MAX_REPORT_RAW_BYTES = 50 * 1024 * 1024;

/** 从会话事件里反推出会话列表（当前版本一个会话一条） */
function buildSessions(events: PrismEvent[]): Session[] {
  const byId = new Map<string, Session>();
  for (const event of events) {
    const existing = byId.get(event.sessionId);
    if (existing) {
      existing.eventCount += 1;
      existing.lastActiveAt = Math.max(existing.lastActiveAt, event.timestamp);
      continue;
    }
    byId.set(event.sessionId, {
      id: event.sessionId,
      startedAt: event.timestamp,
      lastActiveAt: event.timestamp,
      entryUrl: event.url,
      userAgent: event.userAgent,
      release: event.release,
      eventCount: 1,
    });
  }
  return [...byId.values()];
}

/** 把内存里的事件组装成一份报告结构 */
export function buildReport(events: PrismEvent[]): PrismReport {
  return {
    version: REPORT_VERSION,
    generatedAt: Date.now(),
    sessions: buildSessions(events),
    events,
  };
}

/**
 * 导出当前库里的全部数据为一份可嵌入的字符串。
 * 返回压缩 + Base64 后的结果，以及压缩前后体积，便于在 UI 上展示压缩率。
 */
export async function exportCompressedReport(): Promise<{
  payload: string;
  rawBytes: number;
  compressedBytes: number;
}> {
  const events = await readAllEvents();
  const json = JSON.stringify(buildReport(events));
  const rawBytes = new TextEncoder().encode(json).length;
  if (rawBytes > MAX_REPORT_RAW_BYTES) {
    const mb = (rawBytes / 1024 / 1024).toFixed(1);
    throw new Error(
      `待导出数据过大（约 ${mb} MB，上限 ${MAX_REPORT_RAW_BYTES / 1024 / 1024} MB）。` +
        `请先清理旧数据或缩小时间范围后再导出，避免生成一个打不开的巨文件。`,
    );
  }
  const compressed = await compressString(json);
  return {
    payload: toBase64(compressed),
    rawBytes,
    compressedBytes: compressed.length,
  };
}

/** 导入一份报告，返回其中的事件。版本不匹配或内容损坏时给出明确提示而不是崩溃 */
export async function importCompressedReport(payload: string): Promise<PrismReport> {
  let json: string;
  try {
    json = await decodePayload(fromBase64(payload));
  } catch {
    throw new Error('报告内容解析失败：不是有效的 Prism 报告，或导出/传输过程中被损坏');
  }

  let report: PrismReport;
  try {
    report = JSON.parse(json) as PrismReport;
  } catch {
    throw new Error('报告内容解析失败：不是有效的 Prism 报告，或导出/传输过程中被损坏');
  }

  if (report.version !== REPORT_VERSION) {
    throw new Error(
      `报告版本不匹配：文件是 v${report.version}，当前 SDK 支持 v${REPORT_VERSION}`,
    );
  }
  return report;
}
