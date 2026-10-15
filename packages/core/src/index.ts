/**
 * @prism/core 公开入口
 *
 * 这个包运行时零第三方依赖（@prism/shared 只在开发期存在，打包时会被内联，
 * 所以发布出去的 dist 里没有任何 require/import 外部包）。
 * 配合 package.json 里的 "sideEffects": false，业务方做 tree-shaking 时
 * 没用到的插件会被完整摇掉。
 */
import { PrismClientImpl } from './client';
import type { Breadcrumb, PrismClient, PrismOptions } from '@prism/shared';

export { PrismClientImpl } from './client';
export {
  errorsIntegration,
  webVitalsIntegration,
  networkIntegration,
  breadcrumbsIntegration,
} from './integrations';
export { RingBuffer } from './ring-buffer';
export { hashString, shouldSample } from './sampling';
export { sanitizeUrl, sanitizeData } from './sanitize';
export { rateMetric, METRIC_THRESHOLDS, REPORT_VERSION } from '@prism/shared';
export { readAllEvents, clearEvents, putEvents, createIdbTransport } from './storage/idb';
export {
  buildReport,
  exportCompressedReport,
  importCompressedReport,
  compressString,
  decompressString,
  toBase64,
  fromBase64,
} from './report';
export type * from '@prism/shared';

let instance: PrismClient | null = null;

/**
 * 初始化 SDK。
 * 设计成幂等的：重复调用只会返回同一个实例。
 * 因为 script 标签可能被误加两次（比如同时接入了 npm 包和 CDN 版本），
 * 不幂等的话会导致同一个错误被采集两遍。
 */
export function init(options: PrismOptions = {}): PrismClient {
  if (instance) return instance;

  const client = new PrismClientImpl(options);
  instance = client;
  client.setupIntegrations();
  return client;
}

/** 取已初始化的实例。未初始化时返回 null，调用方需要自己判空 */
export function getClient(): PrismClient | null {
  return instance;
}

export function captureException(
  error: unknown,
  hint?: Parameters<PrismClient['captureException']>[1],
): void {
  instance?.captureException(error, hint);
}

export function addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
  instance?.addBreadcrumb(breadcrumb);
}

export function flush(): void {
  instance?.flush();
}

/** 等写入真正完成再继续。跳转页面、导出数据前用它，避免读到旧数据 */
export async function flushAsync(): Promise<void> {
  if (instance) await instance.flushAsync();
}
