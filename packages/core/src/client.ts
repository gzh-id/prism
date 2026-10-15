import type {
  Breadcrumb,
  ErrorEvent,
  Integration,
  MetricName,
  NetworkEvent,
  PerformanceEvent,
  PrismClient,
  PrismEvent,
  PrismEventBase,
  PrismOptions,
  ResolvedOptions,
  ResourceTiming,
  Severity,
} from '@prism/shared';
import { rateMetric } from '@prism/shared';
import { RingBuffer } from './ring-buffer';
import { sanitizeData, sanitizeUrl } from './sanitize';
import { onIdle, onPageHide } from './schedule';
import { putEvents } from './storage/idb';
import { getSession } from './session';
import { shouldSample } from './sampling';

/**
 * 队列上限。超过就直接 flush，防止用户长时间不切后台时内存无限堆积。
 * 50 条的取舍：太小会频繁触发 transport（浪费），太大则页面隐藏前丢失的量变多。
 */
const MAX_QUEUE = 50;

const DEFAULT_MAX_BREADCRUMBS = 20;

function createId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 阶段 1 的默认 transport：只打印到控制台。
 * 阶段 3 会替换成 IndexedDB 落盘；用户也可以自己传入 transport 发到自建接口。
 * 之所以先留一个能跑的默认实现，是为了让「采集 → 队列 → flush」这条链路
 * 第一天就能被验证，而不是等所有模块都写完才能测。
 */
async function defaultTransport(events: PrismEvent[]): Promise<void> {
  // 浏览器里有 IndexedDB 就落盘，这是零后端架构的默认行为：
  // 数据留在本机，不经任何网络请求，也不依赖服务端存在。
  if (typeof indexedDB !== 'undefined') {
    try {
      await putEvents(events);
      return;
    } catch {
      // 写库失败（隐私模式、配额用尽）就退化到控制台，不抛错
    }
  }
  if (typeof console !== 'undefined') {
    console.info(`[prism] flush ${events.length} 条事件`, events);
  }
}

export class PrismClientImpl implements PrismClient {
  readonly options: ResolvedOptions;

  private readonly queue: PrismEvent[] = [];
  private readonly breadcrumbs: RingBuffer<Breadcrumb>;
  private readonly session = getSession();

  /** 采样决策只算一次并缓存，因为它是会话级恒定的 */
  private readonly sampled: boolean;
  private flushScheduled = false;

  constructor(options: PrismOptions = {}) {
    this.options = {
      release: options.release ?? 'unknown',
      environment: options.environment ?? 'production',
      sampleRate: options.sampleRate ?? 1,
      maxBreadcrumbs: options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS,
      debug: options.debug ?? false,
      integrations: options.integrations ?? [],
      beforeSend: options.beforeSend,
      transport: options.transport ?? defaultTransport,
    };

    this.breadcrumbs = new RingBuffer<Breadcrumb>(this.options.maxBreadcrumbs);
    this.sampled = shouldSample(this.session.id, this.options.sampleRate);

    // 页面关闭/切后台是最后一次上报机会，必须提前注册。
    // 走 finalize() 而不是直接 flush：finalize 会先让各插件把内部缓冲（如 Web Vitals
    // 的累计指标）刷进队列，再统一 drain。这样上报时机收口在 client，不依赖插件
    // 各自监听 pagehide 的注册顺序。
    onPageHide(() => this.finalize());

    if (this.options.debug) {
      this.log('初始化完成', {
        sessionId: this.session.id,
        sampled: this.sampled,
        options: this.options,
      });
    }
  }

  /** 每条事件都要带的公共上下文，零后端架构下没有服务端帮忙补这些字段 */
  private base(): Omit<PrismEventBase, 'id'> {
    return {
      timestamp: Date.now(),
      sessionId: this.session.id,
      release: this.options.release,
      environment: this.options.environment,
      url: typeof location !== 'undefined' ? sanitizeUrl(location.href) : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    };
  }

  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
    try {
      this.breadcrumbs.push({ ...breadcrumb, timestamp: Date.now() });
    } catch (error) {
      this.log('addBreadcrumb 失败', error);
    }
  }

  getBreadcrumbs(): Breadcrumb[] {
    return this.breadcrumbs.toArray();
  }

  captureEvent(event: PrismEvent): void {
    // 最外层兜底：SDK 自身的任何异常都不能冒泡到宿主页面，这是硬性要求
    try {
      if (!this.sampled) return;

      let next = this.applyPrivacy(event);

      const beforeSend = this.options.beforeSend;
      if (beforeSend) {
        const result = beforeSend(next);
        // 返回 null 表示业务方主动丢弃这条事件
        if (!result) return;
        next = result;
      }

      this.queue.push(next);

      if (this.queue.length >= MAX_QUEUE) {
        this.flush();
      } else {
        this.scheduleFlush();
      }

      this.log('captured', next.type, next);
    } catch (error) {
      this.log('captureEvent 失败', error);
    }
  }

  captureException(
    error: unknown,
    hint: { kind?: ErrorEvent['kind']; source?: string; severity?: Severity } = {},
  ): void {
    try {
      let message = '未知错误';
      let stack: string | undefined;

      if (error instanceof Error) {
        message = error.message || error.name;
        stack = error.stack;
      } else if (typeof error === 'string') {
        message = error;
      } else {
        // 业务代码里 throw '字符串' 或者 throw { code: 1 } 都很常见，都要能兜住
        try {
          message = JSON.stringify(error) || String(error);
        } catch {
          message = String(error);
        }
      }

      const event: ErrorEvent = {
        ...this.base(),
        id: createId(),
        type: 'error',
        kind: hint.kind ?? 'js',
        severity: hint.severity ?? 'error',
        message,
        stack,
        source: hint.source,
        // 在报错这一刻把面包屑冻结成快照。
        // 不这么做的话，等看板读取时缓冲区早就被后续操作覆盖掉了。
        breadcrumbs: this.getBreadcrumbs(),
      };

      this.captureEvent(event);
    } catch (error_) {
      this.log('captureException 失败', error_);
    }
  }

  captureMetric(
    name: MetricName,
    value: number,
    attribution?: Record<string, unknown>,
  ): void {
    try {
      if (!this.sampled) return;
      const event: PerformanceEvent = {
        ...this.base(),
        id: createId(),
        type: 'performance',
        name,
        value,
        // 评级在内核统一算，插件与看板共用同一套阈值，不会出现两处口径不一致
        rating: rateMetric(name, value),
        attribution,
      };
      this.captureEvent(event);
    } catch (error) {
      this.log('captureMetric 失败', error);
    }
  }

  captureNetwork(info: {
    url: string;
    method: string;
    status: number;
    duration: number;
    transferSize?: number;
    initiatorType?: string;
    timing?: ResourceTiming;
  }): void {
    try {
      if (!this.sampled) return;
      const event: NetworkEvent = {
        ...this.base(),
        id: createId(),
        type: 'network',
        url: info.url,
        method: info.method,
        status: info.status,
        duration: info.duration,
        transferSize: info.transferSize ?? 0,
        initiatorType: info.initiatorType,
        ok: info.status >= 200 && info.status < 400,
        timing: info.timing,
      };
      this.captureEvent(event);
    } catch (error) {
      this.log('captureNetwork 失败', error);
    }
  }

  /**
   * 取出队列并交给 transport，返回 transport 的 Promise（队列为空时返回 null）。
   * 抽出来是为了让 flush 和 flushAsync 共用同一套逻辑，避免两处行为不一致。
   */
  private drain(): Promise<void> | null {
    if (this.queue.length === 0) return null;
    const batch = this.queue.splice(0, this.queue.length);
    const transport = this.options.transport;
    if (!transport) return null;
    // 写库失败不能冒泡到业务页面，这里是 SDK 内部的最后一道防线
    return Promise.resolve(transport(batch)).catch((error) => {
      this.log('transport 失败', error);
    });
  }

  flush(_useBeacon = false): void {
    try {
      void this.drain();
    } catch (error) {
      this.log('flush 失败', error);
    }
  }

  /**
   * 页面隐藏 / 卸载前的「总决算」。
   * 先调用每个插件的 beforeFlush（把内部缓冲刷进队列），再 drain 队列给 transport。
   * 单个插件的 beforeFlush 出错不能影响其他插件，也不能影响最终 drain。
   */
  finalize(): void {
    try {
      for (const integration of this.options.integrations) {
        try {
          integration.beforeFlush?.(this);
        } catch (error) {
          this.log(`插件 ${integration.name} 的 beforeFlush 失败`, error);
        }
      }
      void this.drain();
    } catch (error) {
      this.log('finalize 失败', error);
    }
  }

  async flushAsync(): Promise<void> {
    try {
      await this.drain();
    } catch (error) {
      this.log('flush 失败', error);
    }
  }

  /** 批量注册插件。单个插件挂掉不能影响其他插件 */
  setupIntegrations(): void {
    for (const integration of this.options.integrations) {
      try {
        integration.setup(this);
        this.log('插件已启用', integration.name);
      } catch (error) {
        this.log(`插件 ${integration.name} 启动失败`, error);
      }
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    onIdle(() => {
      this.flushScheduled = false;
      this.flush();
    });
  }

  /** 隐私兜底：即使调用方忘了脱敏，这里也会再删一遍 */
  private applyPrivacy(event: PrismEvent): PrismEvent {
    if (event.type === 'network') {
      const networkEvent: NetworkEvent = { ...event, url: sanitizeUrl(event.url) };
      return networkEvent;
    }
    if (event.type === 'error') {
      return {
        ...event,
        breadcrumbs: event.breadcrumbs.map((crumb) =>
          crumb.data ? { ...crumb, data: sanitizeData(crumb.data) } : crumb,
        ),
      };
    }
    return event;
  }

  private log(...args: unknown[]): void {
    if (this.options.debug && typeof console !== 'undefined') {
      console.info('[prism]', ...args);
    }
  }
}

export type { Integration };
