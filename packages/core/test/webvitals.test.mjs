/**
 * Web Vitals 插件的行为测试（用假浏览器环境跑）
 *
 * 为什么值得专门为它写测试：
 * 这个插件踩过一个真实缺陷 —— 指标只在「浏览器空闲」时上报，
 * 于是用户在页面加载后立刻点按钮跳走的话，空闲回调还没触发页面就销毁了，
 * 最后一批 LCP/CLS/INP 直接丢失，表现在看板上就是性能页一片空白。
 * 这类 bug 靠手点很难复现（快慢鼠标结果不一样），必须用测试钉住。
 *
 * 为什么用假的 window/document 而不是真浏览器：
 * 这一层测的是「上报时机的调度逻辑」，跟真实 PerformanceObserver 的实现无关；
 * 真实浏览器里的端到端验证留给阶段 6 的 Playwright。
 * 这里刻意把浏览器对象做成可控的替身，才能真正断言「还没空闲就跳走」这个时序。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/** 收集「某个集成/report 希望外界看到的行为」的假 client，只实现插件会用到的接口 */
function createFakeClient() {
  const metrics = [];
  const flushed = [];
  return {
    metrics,
    flushed,
    client: {
      captureMetric(name, value, attribution) {
        metrics.push({ name, value, attribution });
      },
      flush(useBeacon) {
        flushed.push(useBeacon === true);
      },
    },
  };
}

/**
 * 装一套最小可用的浏览器替身。
 *
 * 关键点：window 上**不提供** requestIdleCallback。
 * 这模拟的是 Safari，也是让 schedule.ts 走 setTimeout 兜底分支的情形；
 * 更重要的是它保证「空闲上报」不会在我们断言之前偷偷发生。
 */
function installFakeBrowser() {
  const listeners = { window: {}, document: {} };
  const observers = [];

  const fakeWindow = {
    addEventListener(type, handler) {
      (listeners.window[type] = listeners.window[type] || []).push(handler);
    },
  };

  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener(type, handler) {
      (listeners.document[type] = listeners.document[type] || []).push(handler);
    },
  };

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      this.types = [];
      observers.push(this);
    }
    observe(options) {
      this.types.push(options.type);
    }
    /** 测试专用：手动往这个 observer 里灌一条 entry */
    emit(entries) {
      this.callback({ getEntries: () => entries });
    }
  }

  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  globalThis.PerformanceObserver = FakePerformanceObserver;

  /** 找到订阅了某个 entryType 的 observer */
  const observerOf = (type) => {
    const found = observers.find((o) => o.types.includes(type));
    assert.ok(found, `应当有 observer 订阅了 ${type}`);
    return found;
  };

  const fire = (target, type) => {
    for (const handler of listeners[target][type] || []) handler();
  };

  const uninstall = () => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.PerformanceObserver;
  };

  return { observers, observerOf, fire, uninstall, listeners };
}

test('Web Vitals：页面隐藏前必须把还没上报的指标兜底写出去', async () => {
  const browser = installFakeBrowser();
  const { metrics, flushed, client } = createFakeClient();

  try {
    const { webVitalsIntegration } = await import('../dist/index.js');
    const integration = webVitalsIntegration();
    integration.setup(client);

    // 灌一条 LCP entry —— 此刻它只应该进到插件内部的 pending 缓冲区
    browser.observerOf('largest-contentful-paint').emit([{ startTime: 2800 }]);

    assert.equal(metrics.length, 0, '空闲回调还没触发，不应该已经上报');

    // 模拟用户立刻关闭/切走页面
    // 页面隐藏由 client.finalize() 统一触发，这里直接调用集成暴露的 beforeFlush
    integration.beforeFlush(client);

    assert.equal(metrics.length, 1, '兜底上报必须把 pending 的 LCP 写出来');
    assert.equal(metrics[0].name, 'LCP');
    assert.equal(metrics[0].value, 2800);
    // 关键：写完还得自己 flush 一次。
    // client 自己的 pagehide 处理比插件注册得早，那次 flush 发生在指标入队之前。
    assert.equal(flushed.length, 1, '兜底后必须再补一次 flush，否则数据留在队列里没人接管');
    assert.equal(flushed[0], true, '页面隐藏场景要用 beacon 语义');
  } finally {
    browser.uninstall();
  }
});

test('Web Vitals：LCP 多次更新只保留最大值，且同批次合并成一条', async () => {
  const browser = installFakeBrowser();
  const { metrics, client } = createFakeClient();

  try {
    const { webVitalsIntegration } = await import('../dist/index.js');
    const integration = webVitalsIntegration();
    integration.setup(client);

    const lcp = browser.observerOf('largest-contentful-paint');
    lcp.emit([{ startTime: 1200 }]);
    lcp.emit([{ startTime: 900, element: undefined }]); // 更小的候选，应该被忽略
    lcp.emit([{ startTime: 3100 }]);

    // 页面隐藏由 client.finalize() 统一触发，这里直接调用集成暴露的 beforeFlush
    integration.beforeFlush(client);

    assert.equal(metrics.length, 1, '三次更新应合并为一条事件');
    assert.equal(metrics[0].value, 3100, 'LCP 取最大值');
  } finally {
    browser.uninstall();
  }
});

test('Web Vitals：CLS 累加；值为 0 也要上报（没有布局偏移是有效结论）', async () => {
  const browser = installFakeBrowser();
  const { metrics, client } = createFakeClient();

  try {
    const { webVitalsIntegration } = await import('../dist/index.js');
    const integration = webVitalsIntegration();
    integration.setup(client);

    const cls = browser.observerOf('layout-shift');
    // 用户交互导致的位移必须被排除
    cls.emit([{ value: 0.5, hadRecentInput: true }]);
    cls.emit([{ value: 0.08 }]);
    cls.emit([{ value: 0.05 }]);

    // 页面隐藏由 client.finalize() 统一触发，这里直接调用集成暴露的 beforeFlush
    integration.beforeFlush(client);

    const shifts = metrics.filter((m) => m.name === 'CLS');
    assert.equal(shifts.length, 1);
    assert.ok(Math.abs(shifts[0].value - 0.13) < 1e-9, 'CLS 应累加且排除 hadRecentInput');

    // 单独验证「全是 0 也上报」
    metrics.length = 0;
    cls.emit([{ value: 0 }]);
    // 页面隐藏由 client.finalize() 统一触发，这里直接调用集成暴露的 beforeFlush
    integration.beforeFlush(client);
    const zero = metrics.filter((m) => m.name === 'CLS');
    assert.equal(zero.length, 1, 'CLS=0 是有意义的好结果，不能因为值为 0 就丢掉');
    assert.equal(zero[0].value, 0);
  } finally {
    browser.uninstall();
  }
});

test('Web Vitals：不支持的 entryType 不能拖垮其他指标', async () => {
  const browser = installFakeBrowser();
  const { metrics, client } = createFakeClient();

  try {
    // 模拟 Safari：observe('layout-shift') 直接抛错
    class PickyObserver {
      constructor(callback) {
        this.callback = callback;
        PickyObserver.instances.push(this);
        this.types = [];
      }
      observe(options) {
        if (options.type === 'layout-shift') throw new Error('unsupported');
        this.types.push(options.type);
      }
    }
    PickyObserver.instances = [];
    globalThis.PerformanceObserver = PickyObserver;

    const { webVitalsIntegration } = await import('../dist/index.js');
    // 不应该抛异常
    const integration = webVitalsIntegration();
    integration.setup(client);

    const lcp = PickyObserver.instances.find((o) => o.types.includes('largest-contentful-paint'));
    assert.ok(lcp, 'layout-shift 不被支持时，后续指标仍然要正常订阅');
    lcp.callback({ getEntries: () => [{ startTime: 2200 }] });

    // 页面隐藏由 client.finalize() 统一触发，这里直接调用集成暴露的 beforeFlush
    integration.beforeFlush(client);
    assert.equal(metrics.filter((m) => m.name === 'LCP').length, 1);
  } finally {
    browser.uninstall();
  }
});

test('Web Vitals：FCP/TTFB 取首次值，后续重复 entry 不覆盖', async () => {
  const browser = installFakeBrowser();
  const { metrics, client } = createFakeClient();

  try {
    const { webVitalsIntegration } = await import('../dist/index.js');
    const integration = webVitalsIntegration();
    integration.setup(client);

    browser
      .observerOf('paint')
      .emit([{ name: 'first-paint', startTime: 300 }, { name: 'first-contentful-paint', startTime: 800 }]);
    browser.observerOf('paint').emit([{ name: 'first-contentful-paint', startTime: 9999 }]);

    browser.observerOf('navigation').emit([{ responseStart: 120 }]);
    browser.observerOf('navigation').emit([{ responseStart: 8888 }]);

    // 页面隐藏由 client.finalize() 统一触发，这里直接调用集成暴露的 beforeFlush
    integration.beforeFlush(client);

    assert.equal(metrics.find((m) => m.name === 'FCP').value, 800, 'FCP 只认第一次');
    assert.equal(metrics.find((m) => m.name === 'TTFB').value, 120, 'TTFB 只认第一次');
    assert.equal(
      metrics.filter((m) => m.name === 'FCP').length,
      1,
      '重复 entry 不应产生第二条事件',
    );
  } finally {
    browser.uninstall();
  }
});

test('Web Vitals：INP 取第 98 百分位而非最大值', async () => {
  const browser = installFakeBrowser();
  const { metrics, client } = createFakeClient();
  const { webVitalsIntegration } = await import('../dist/index.js');
  const integration = webVitalsIntegration();

  try {
    integration.setup(client);

    const ev = browser.observerOf('event');
    // 模拟多次交互，分布差异明显：100 / 200 / 300 / 5000
    ev.emit([{ duration: 100 }, { duration: 5000 }, { duration: 200 }, { duration: 300 }]);

    integration.beforeFlush(client);

    const inp = metrics.filter((m) => m.name === 'INP');
    assert.equal(inp.length, 1, '多次交互应合并为一条 INP 事件');
    // p98 of [100,200,300,5000]：排序后取下标 floor(0.98*3)=2 → 300
    assert.equal(inp[0].value, 300, 'INP 应为 p98（300）而非最大值（5000）');
  } finally {
    browser.uninstall();
  }
});
