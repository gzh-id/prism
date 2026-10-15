import type { Integration, PrismClient, ResourceTiming } from '@prism/shared';

/**
 * 网络采集插件
 *
 * 做法是「代理」而不是「替换」：包一层壳记录耗时，然后原样调用浏览器原生方法。
 * 这是 SDK 侵入第三方页面时最基本的礼貌 —— 任何对原生 API 的行为改变
 * （哪怕只是少传一个参数）都可能让宿主页面直接崩掉。
 *
 * 隐私红线：**只取 URL、方法与时序，绝不碰请求体和响应体。**
 * 响应体是要读流才能拿到的，一旦读了流，业务代码再读就是空数据，这是典型的踩坑点。
 */

/**
 * 从 Resource Timing 里取出阶段耗时，供看板画瀑布图。
 * 拿不到就返回 undefined —— 跨域资源没有 Timing-Allow-Origin 头时，
 * 浏览器会把除 startTime/duration 外的所有字段置 0，这是它的隐私设计，绕不过去。
 */
function readTiming(url: string): ResourceTiming | undefined {
  try {
    if (typeof performance === 'undefined' || !performance.getEntriesByName) return undefined;
    const entries = performance.getEntriesByName(url, 'resource');
    // 同一 URL 可能被请求多次，取最后一次
    const entry = entries[entries.length - 1] as
      | (PerformanceEntry & {
          domainLookupStart?: number;
          domainLookupEnd?: number;
          connectStart?: number;
          connectEnd?: number;
          secureConnectionStart?: number;
          requestStart?: number;
          responseStart?: number;
          responseEnd?: number;
        })
      | undefined;
    if (!entry) return undefined;

    const dnsStart = entry.domainLookupStart ?? 0;
    // 全为 0 说明是被浏览器屏蔽的跨域资源，不返回假数据
    if (!entry.requestStart || !entry.responseStart) return undefined;

    return {
      dns: (entry.domainLookupEnd ?? 0) - dnsStart,
      tcp: (entry.connectEnd ?? 0) - (entry.connectStart ?? 0),
      ssl: entry.secureConnectionStart
        ? (entry.connectEnd ?? 0) - entry.secureConnectionStart
        : 0,
      ttfb: entry.responseStart - entry.requestStart,
      download: (entry.responseEnd ?? 0) - entry.responseStart,
    };
  } catch {
    return undefined;
  }
}

function normalizeInput(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  // Request 对象时取 url 字段
  return (input as Request).url ?? String(input);
}

export function networkIntegration(): Integration {
  return {
    name: 'network',
    setup(client: PrismClient) {
      if (typeof window === 'undefined') return;

      // ---------- fetch ----------
      if (typeof window.fetch === 'function') {
        const originalFetch = window.fetch;
        // 必须用 function 而不是箭头函数：需要保留 this 指向（某些库依赖它）
        window.fetch = function patchedFetch(input, init) {
          const url = normalizeInput(input as RequestInfo | URL);
          const method = (init?.method ?? (input as Request)?.method ?? 'GET').toUpperCase();
          const start = performance.now();

          return originalFetch.call(this, input as RequestInfo, init).then(
            (response) => {
              client.captureNetwork({
                url,
                method,
                status: response.status,
                duration: performance.now() - start,
                transferSize: 0,
                timing: readTiming(url),
              });
              return response;
            },
            (error: unknown) => {
              // 请求失败也要记一笔，否则看板上只看到成功请求，慢接口反而消失了
              client.captureNetwork({
                url,
                method,
                status: 0,
                duration: performance.now() - start,
                timing: readTiming(url),
              });
              throw error;
            },
          );
        };
      }

      // ---------- XMLHttpRequest ----------
      const XHR = (window as unknown as { XMLHttpRequest?: typeof XMLHttpRequest })
        .XMLHttpRequest;
      if (typeof XHR === 'function') {
        const originalOpen = XHR.prototype.open;
        const originalSend = XHR.prototype.send;

        XHR.prototype.open = function patchedOpen(
          this: XMLHttpRequest & { __prism?: { url: string; method: string; start: number } },
          method: string,
          url: string | URL,
          ...rest: unknown[]
        ) {
          // 把元信息挂在实例上，等 send / loadend 时再取出来
          this.__prism = {
            url: typeof url === 'string' ? url : url.href,
            method: method.toUpperCase(),
            start: 0,
          };
          return (originalOpen as unknown as (...args: unknown[]) => void).call(
            this,
            method,
            url,
            ...rest,
          );
        };

        XHR.prototype.send = function patchedSend(
          this: XMLHttpRequest & { __prism?: { url: string; method: string; start: number } },
          ...args: unknown[]
        ) {
          const meta = this.__prism;
          const start = performance.now();
          if (meta) meta.start = start;

          // loadend 在成功、失败、中止三种情况下都会触发，是最可靠的收尾时机
          this.addEventListener('loadend', () => {
            try {
              if (!meta) return;
              client.captureNetwork({
                url: meta.url,
                method: meta.method,
                status: this.status,
                duration: performance.now() - start,
                timing: readTiming(meta.url),
              });
            } catch {
              // 采集失败不能影响请求本身
            }
          });

          return (originalSend as unknown as (...args: unknown[]) => void).apply(this, args);
        };
      }
    },
  };
}
