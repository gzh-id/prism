/**
 * Prism 事件模型 —— 全项目唯一真相来源
 *
 * 这个文件只放「类型」和「纯常量/纯函数」，不放任何副作用。
 * core / dashboard / cli 三方都从这里 import，任何模块都不许自己重新定义事件结构。
 *
 * 设计原则（面试时会被追问，务必理解）：
 * 1. 每条事件都自带 sessionId / release / environment，因为零后端架构下没有服务端帮你关联上下文，
 *    所有关联信息必须在采集时就写进事件里，否则落盘之后就再也拼不回来了。
 * 2. 网络事件只存 URL 与时序，绝不存请求体/响应体 —— 这是本项目「隐私优先」的核心承诺。
 * 3. 面包屑只在 error 事件上携带快照，而不是每条都携带，否则数据量会翻 20 倍。
 */

/** 事件严重程度，与常见日志分级保持一致，便于后续对接告警 */
export type Severity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/** 面包屑分类：用来在错误详情里按类型过滤用户行为轨迹 */
export type BreadcrumbCategory =
  | 'click'
  | 'navigation'
  | 'network'
  | 'console'
  | 'lifecycle';

/** 核心性能指标。只保留 Google 官方 Core Web Vitals 及两个关键辅助指标 */
export type MetricName = 'FCP' | 'LCP' | 'CLS' | 'INP' | 'TTFB';

/** 指标评级，直接沿用 web-vitals 官方的三档划分 */
export type MetricRating = 'good' | 'needs-improvement' | 'poor';

/** 错误的四种来源，决定看板上怎么归类展示 */
export type ErrorKind = 'js' | 'unhandledrejection' | 'resource' | 'blank-screen';

/**
 * Web Vitals 官方阈值，单位毫秒（CLS 是无量纲的布局偏移累计值）。
 * 元组含义：[good 上限, poor 上限]
 * 数值来源：https://web.dev/articles/vitals 的官方定义，不要凭感觉改。
 */
export const METRIC_THRESHOLDS: Record<MetricName, readonly [number, number]> = {
  FCP: [1800, 3000],
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  TTFB: [800, 1800],
};

/** 把指标原始值换算成三档评级。core 与 dashboard 共用，避免两处阈值不一致 */
export function rateMetric(name: MetricName, value: number): MetricRating {
  const [good, poor] = METRIC_THRESHOLDS[name];
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

/** 一条用户行为轨迹。定长，由 core 的环形缓冲区维护 */
export interface Breadcrumb {
  timestamp: number;
  category: BreadcrumbCategory;
  level: Severity;
  /** 人类可读的一句话描述，看板时间轴上直接展示这个 */
  message: string;
  /** 结构化补充信息，比如点击的元素选择器、请求的状态码 */
  data?: Record<string, unknown>;
}

/** 所有事件的公共字段 */
export interface PrismEventBase {
  /** 事件唯一 id。同时作为 IndexedDB 主键，避免重复写入同一条错误 */
  id: string;
  timestamp: number;
  sessionId: string;
  /** 应用版本号，用来对比「哪个版本开始变差的」 */
  release: string;
  environment: string;
  url: string;
  userAgent: string;
}

export interface ErrorEvent extends PrismEventBase {
  type: 'error';
  kind: ErrorKind;
  message: string;
  /** 原始堆栈字符串。压缩代码的还原由 CLI 侧用 source map 完成，SDK 不做 */
  stack?: string;
  /** JS 错误填来源文件；资源错误填加载失败的资源 URL */
  source?: string;
  severity: Severity;
  /** 报错发生时的面包屑快照，由 core 在 captureException 时冻结 */
  breadcrumbs: Breadcrumb[];
}

export interface PerformanceEvent extends PrismEventBase {
  type: 'performance';
  name: MetricName;
  value: number;
  rating: MetricRating;
  /** 归因信息，例如 LCP 对应哪个 DOM 元素、CLS 由哪个元素位移造成 */
  attribution?: Record<string, unknown>;
}

/**
 * 一次请求的阶段耗时拆分，看板的瀑布图直接消费这个结构。
 * 单位是毫秒，均为「该阶段自身耗时」而不是累计时间点。
 * 注意：跨域资源如果没返回 Timing-Allow-Origin 响应头，
 * 除 startTime/duration 外的字段都会被浏览器置 0，这是浏览器故意的限制。
 */
export interface ResourceTiming {
  dns: number;
  tcp: number;
  ssl: number;
  /** 从请求发出到收到第一个字节，也就是常说的「服务器响应」耗时 */
  ttfb: number;
  download: number;
}

export interface NetworkEvent extends PrismEventBase {
  type: 'network';
  /** 已经过脱敏的 URL：query 中的敏感参数会被 beforeSend 剔除 */
  url: string;
  method: string;
  status: number;
  duration: number;
  /** 传输字节数，可能是 0（跨域资源未开启 Timing-Allow-Origin 时拿不到） */
  transferSize: number;
  initiatorType?: string;
  ok: boolean;
  /** 阶段耗时拆分，拿不到时整个字段不存在 */
  timing?: ResourceTiming;
}

export type PrismEvent = ErrorEvent | PerformanceEvent | NetworkEvent;
export type PrismEventType = PrismEvent['type'];

/** 一次会话。零后端架构下由 SDK 自己维护，用于看板按会话聚合 */
export interface Session {
  id: string;
  startedAt: number;
  lastActiveAt: number;
  entryUrl: string;
  userAgent: string;
  release: string;
  eventCount: number;
}

/**
 * 采集插件接口。
 * 用 setup(client) 而不是直接导出函数，是为了让插件能拿到 client 去写事件、加面包屑，
 * 同时保持插件本身无状态 —— 这样才能做 tree-shaking，不用的插件不进包。
 */
export interface Integration {
  name: string;
  setup(client: PrismClient): void;
  /**
   * 页面即将隐藏 / 卸载时由 client.finalize() 调用，让插件把还留在内部缓冲区、
   * 尚未交进队列的数据刷出去（例如 Web Vitals 的累计指标）。
   *
   * 这样「上报时机」统一收口到 client，插件不再各自监听 pagehide，
   * 也就不依赖 DOM 事件注册顺序。可选；不实现则 finalize 时跳过该插件。
   */
  beforeFlush?: (client: PrismClient) => void;
}

export interface PrismOptions {
  release?: string;
  environment?: string;
  /** 采样率 0~1。同一会话的采样决策是稳定的，实现见 core/sampling.ts */
  sampleRate?: number;
  maxBreadcrumbs?: number;
  integrations?: Integration[];
  /** 上报前的最后一道关卡：返回 null 表示丢弃该事件，也用来做脱敏 */
  beforeSend?: (event: PrismEvent) => PrismEvent | null;
  /** 传输实现。默认走 IndexedDB 落盘；可替换成 sendBeacon 或自建接口 */
  transport?: (events: PrismEvent[]) => void | Promise<void>;
  debug?: boolean;
}

/** init 之后选项已经补齐默认值，业务代码不需要再判空 */
export interface ResolvedOptions {
  release: string;
  environment: string;
  sampleRate: number;
  maxBreadcrumbs: number;
  debug: boolean;
  integrations: Integration[];
  beforeSend?: (event: PrismEvent) => PrismEvent | null;
  transport?: (events: PrismEvent[]) => void | Promise<void>;
}

export interface PrismClient {
  readonly options: ResolvedOptions;
  /** 写入一条事件。会依次经过采样、脱敏、beforeSend */
  captureEvent(event: PrismEvent): void;
  /**
   * 上报一个性能指标。插件用它上报 Web Vitals，
   * 由内核统一补上下文、算评级，插件不需要知道这些细节。
   */
  captureMetric(
    name: MetricName,
    value: number,
    attribution?: Record<string, unknown>,
  ): void;
  /**
   * 上报一次网络请求。只传业务字段，公共上下文由内核补。
   * 之所以不直接暴露 captureEvent，是为了让插件拿不到「构造任意事件」的能力，
   * 保证事件结构的统一。
   */
  captureNetwork(info: {
    url: string;
    method: string;
    status: number;
    duration: number;
    transferSize?: number;
    initiatorType?: string;
    timing?: ResourceTiming;
  }): void;
  /** 手动上报一个异常，业务 try/catch 里常用 */
  captureException(
    error: unknown,
    hint?: { kind?: ErrorKind; source?: string; severity?: Severity },
  ): void;
  addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void;
  /** 取当前面包屑快照，按时间正序返回 */
  getBreadcrumbs(): Breadcrumb[];
  /** 把队列里的事件交给 transport。useBeacon 为真时走 sendBeacon */
  flush(useBeacon?: boolean): void;
  /**
   * 页面隐藏 / 卸载前的「总决算」：先调用所有插件的 beforeFlush 把它们内部缓冲刷进队列，
   * 再把队列 drain 给 transport。由 client 在 pagehide 时自动触发，
   * 业务方一般不需要手动调用，但跳转前想确保数据落盘时可以显式调用。
   */
  finalize(): void;
  /**
   * 同上，但返回 Promise，调用方可以等写入真正完成。
   *
   * 为什么需要两个版本：transport（IndexedDB 落盘）是异步的，而 flush 是同步返回的。
   * 演示站点「点完按钮立刻跳走看板」这种场景下，如果不等写入完成就离开页面，
   * 看板可能读到旧数据，用户会误以为 SDK 坏了。跳转前 await 这个版本即可。
   */
  flushAsync(): Promise<void>;
}

/**
 * 导出报告的顶层结构（阶段 3 单文件 HTML 导出用）。
 * 带 version 是为了以后改结构时能识别旧报告并给出提示，而不是直接崩掉。
 */
export interface PrismReport {
  version: number;
  generatedAt: number;
  sessions: Session[];
  events: PrismEvent[];
}

export const REPORT_VERSION = 1;
