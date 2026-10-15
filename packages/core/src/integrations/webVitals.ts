import type { Integration, MetricName, PrismClient } from '@prism/shared';
import { onIdle } from '../schedule';

/**
 * Web Vitals 采集插件
 *
 * 为什么不用现成的 web-vitals 库：
 * 一是要守 8KB 体积预算，二是这些指标的算法本身就是面试考点，自己实现才讲得清。
 *
 * 四个必须知道的坑：
 * 1. **buffered: true 不能漏**。SDK 通常是异步加载的，等它起来时 FCP 早就算完了。
 *    不加这个参数就只能拿到空数据，而且这种 bug 在开发环境下很难复现。
 * 2. **每个 entryType 都要单独 try/catch**。Safari 对 'layout-shift'、'event'
 *    的支持落后于 Chrome，PerformanceObserver.observe 遇到不支持的类型会直接抛错。
 *    不逐个兜住的话，一个不支持的类型会让后面所有指标都采集不到。
 * 3. **LCP 和 CLS 会多次触发**。LCP 每出现一个更大的元素就更新一次；
 *    CLS 是持续累加的。所以收集和配置上报要分开：观察回调只更新「累计值」，
 *    真正写事件由统一的调度器决定时机。
 * 4. **必须在页面隐藏时兜底上报**。原本只依赖 requestIdleCallback/setTimeout 上报，
 *    如果用户在页面加载后很短时间内点击按钮跳转，空闲回调还没触发页面就销毁了，
 *    最后一批 LCP/CLS/INP 直接丢失 —— 表现在看板上就是「性能页一片空白」。
 *    官方 web-vitals 库的做法也是在 visibilitychange/pagehide 时 finalize，这里是同一思路。
 *    早期实现里本插件自己监听 pagehide 再 flushPending + client.flush，但这依赖一个隐含顺序：
 *    client 的 pagehide 必须比插件注册得早，否则那次 flush 发生在指标入队之前、等于白调。
 *    现在改为本插件只暴露 beforeFlush，由 client.finalize() 在页面隐藏时统一调用，
 *    彻底解耦，不再依赖 DOM 事件注册顺序。
 */

/**
 * 安全地订阅一种性能指标。
 * 浏览器不支持时静默跳过 —— 少采集一个指标，好过整个 SDK 崩掉。
 */
function observeEntry(
  type: string,
  onEntries: (entries: PerformanceEntry[]) => void,
): void {
  try {
    if (typeof PerformanceObserver === 'undefined') return;
    const observer = new PerformanceObserver((list) => {
      onEntries(list.getEntries());
    });
    observer.observe({ type, buffered: true });
  } catch {
    // 该类型不被支持，跳过
  }
}

/** 指标的合并方式。不同指标的累积语义不一样，必须分开处理 */
type MergeMode =
  /** 只取第一次：FCP、TTFB 这类「一条就定终身」的指标 */
  | 'once'
  /** 取最大值：LCP（不断出现更大的元素）、INP 早期近似 */
  | 'max'
  /** 累加：CLS（布局偏移量是持续叠加的） */
  | 'sum';

interface PendingMetric {
  value: number;
  attribution?: Record<string, unknown>;
}

/** 分位值：排序后取下标 floor(p*(n-1))，p∈[0,1]。n=0 时返回 0 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)));
  return sorted[idx];
}

/**
 * 把一次观测结果合并进待上报缓冲区。
 *
 * 为什么多这一层，而不是在 Observer 回调里直接 captureMetric：
 * 回调的触发频率由浏览器决定，LCP 在一次加载里可能触发十几次。
 * 逐条上报会把队列灌满，趋势图上也会出现一堆同一个加载过程的中间值，看不出真实分布。
 * 先在内存里合并，再由调度器决定「什么时候交出去」，职责才干净。
 */
function merge(
  pending: Map<MetricName, PendingMetric>,
  mode: MergeMode,
  name: MetricName,
  value: number,
  attribution?: Record<string, unknown>,
): void {
  const current = pending.get(name);

  if (mode === 'once') {
    if (current) return;
    pending.set(name, { value, attribution });
    return;
  }

  if (mode === 'max') {
    // 比已有值小就没意义 —— LCP 关心的都是最差的那一次
    if (current && current.value >= value) return;
    pending.set(name, { value, attribution });
    return;
  }

  pending.set(name, {
    value: (current?.value ?? 0) + value,
    attribution: attribution ?? current?.attribution,
  });
}

export function webVitalsIntegration(): Integration {
  // beforeFlush 在 setup 时才拿到真正的 flushPending 闭包，这里先留空引用
  let flushPendingRef: (() => void) | null = null;

  return {
    name: 'webVitals',
    setup(client: PrismClient) {
      if (typeof PerformanceObserver === 'undefined') return;

      /** 累计但还没交给内核的指标 */
      const pending = new Map<MetricName, PendingMetric>();
      /**
       * INP 官方定义为「近似第 98 百分位交互延迟」，不是最大值。
       * 单独攒样本，在 flush 时算 p98，避免引入额外依赖。
       */
      const inpSamples: number[] = [];
      let idleScheduled = false;

      function flushPending(): void {
        if (pending.size === 0 && inpSamples.length === 0) return;
        for (const [name, item] of pending) {
          client.captureMetric(name, item.value, item.attribution);
        }
        pending.clear();
        if (inpSamples.length > 0) {
          client.captureMetric('INP', percentile(inpSamples, 0.98));
          inpSamples.length = 0;
        }
      }

      function scheduleIdleFlush(): void {
        // 用一个标记位合并掉高频更新，避免每个 entry 都排一次空闲任务
        if (idleScheduled) return;
        idleScheduled = true;
        onIdle(() => {
          idleScheduled = false;
          flushPending();
        });
      }

      const collect = (
        mode: MergeMode,
        name: MetricName,
        value: number,
        attribution?: Record<string, unknown>,
      ): void => {
        // CLS 例外：0 是个有意义的答案（「这一路没发生布局偏移」），必须上报。
        // 其余指标为 0 说明没取到值，报上去只会污染趋势图。
        if (mode !== 'sum' && !(value > 0)) return;
        merge(pending, mode, name, value, attribution);
        scheduleIdleFlush();
      };

      // 把真正刷缓冲的逻辑挂到 beforeFlush，由 client.finalize() 在页面隐藏时统一调用
      flushPendingRef = flushPending;

      observeEntry('paint', (entries) => {
        for (const entry of entries) {
          // paint 类型里同时有 first-paint 和 first-contentful-paint，只要后者
          if (entry.name === 'first-contentful-paint') {
            collect('once', 'FCP', entry.startTime);
          }
        }
      });

      observeEntry('largest-contentful-paint', (entries) => {
        for (const entry of entries) {
          // startTime 就是 LCP 的绝对时间点，直接作为指标值
          const el = (entry as PerformanceEntry & { element?: Element }).element;
          // LCP 元素信息有助于定位「到底是哪张图慢」，能拿到就记下来
          collect('max', 'LCP', entry.startTime, { element: el?.tagName?.toLowerCase() ?? '' });
        }
      });

      observeEntry('layout-shift', (entries) => {
        for (const entry of entries) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          // 排除用户交互后 500ms 内的位移 —— 那是用户自己点出来的，不算布局不稳定
          if (shift.hadRecentInput) continue;
          collect('sum', 'CLS', shift.value ?? 0);
        }
      });

      observeEntry('event', (entries) => {
        for (const entry of entries) {
          const duration = (entry as PerformanceEntry & { duration: number }).duration;
          // 收集所有交互耗时样本，flush 时算 p98（而非简单取最大）
          if (typeof duration === 'number' && duration >= 0) inpSamples.push(duration);
        }
      });

      // TTFB：来自 navigation timing，只有一条，取第一次即可
      observeEntry('navigation', (entries) => {
        for (const entry of entries) {
          const nav = entry as PerformanceEntry & { responseStart?: number };
          if (typeof nav.responseStart === 'number') {
            collect('once', 'TTFB', nav.responseStart);
          }
        }
      });
    },

    // 页面隐藏时由 client.finalize() 调用：把还在 pending 的指标交出去，并补一次 flush
    beforeFlush(client: PrismClient) {
      flushPendingRef?.();
      // 用 beacon 语义，确保数据在页面销毁前真正交出去
      client.flush(true);
    },
  };
}

/** 导出给外部做类型标注用，避免调用方硬编码字符串 */
export type WebVitalsMetric = MetricName;
