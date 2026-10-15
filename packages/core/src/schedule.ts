/**
 * 调度与生命周期 —— 决定「什么时候把数据交出去」
 *
 * 两个时机：
 * 1. 空闲时：等浏览器闲下来再干活，不要和首屏渲染抢主线程。
 *    否则监控 SDK 本身就成了拖慢页面的元凶，这在面试里是必问的。
 * 2. 页面隐藏时：用户关标签页/切后台的那一刻，是最后一次上报机会。
 *    这时候必须用 sendBeacon，因为普通的 fetch 会随页面销毁被浏览器直接取消。
 */

/**
 * 在浏览器空闲时执行回调。
 * Safari 至今（2026）仍不支持 requestIdleCallback，所以必须准备兜底，
 * 否则在 Safari 上数据永远发不出来，而且这种 bug 极难发现。
 */
export function onIdle(callback: () => void, timeout = 2000): void {
  const w = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(callback, { timeout });
  } else {
    setTimeout(callback, 200);
  }
}

/**
 * 页面即将不可见时执行。同时监听 visibilitychange 与 pagehide，
 * 因为移动端 Safari 的 pagehide 更可靠，而桌面端切标签页只触发 visibilitychange。
 */
export function onPageHide(callback: () => void): void {
  // 必须判空：SSR、Node 单元测试、Web Worker 里都没有 document/window。
  // 不判的话 SDK 一加载就崩，这也是「SDK 不能拖垮宿主」这条底线的具体体现。
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      callback();
    }
  });
  window.addEventListener('pagehide', callback);
}
