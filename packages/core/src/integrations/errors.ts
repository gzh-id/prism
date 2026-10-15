import type { Integration, PrismClient } from '@prism/shared';

/**
 * 错误采集插件
 *
 * 覆盖四类错误来源，其中「资源加载失败」和「白屏」是最容易被忽略、
 * 但线上最常见的两类 —— 它们不会产生 JS 异常，用 try/catch 是抓不到的。
 *
 * 关键实现细节（面试高频）：
 * 1. 资源加载失败的 error 事件**不冒泡**，只能在捕获阶段（第三个参数 true）监听到。
 *    如果写成 window.onerror = fn，你永远拿不到图片/脚本加载失败。
 * 2. 区分两类错误靠 event.target：JS 错误时 target 是 window，资源错误时是具体元素。
 * 3. 每个监听器内部都单独 try/catch —— SDK 的底线是不能因为自己出错而拖垮宿主页面。
 */

/** 白屏检测的等待时间。太短会误报 SPA 的异步渲染，太长则失去了预警意义 */
const BLANK_SCREEN_DELAY = 3000;

/** 这些标签即使存在也不算「页面有内容」 */
const INVISIBLE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TITLE']);

export interface ErrorsIntegrationOptions {
  /** 是否开启白屏检测。默认开启 */
  detectBlankScreen?: boolean;
  /** 白屏检测的等待毫秒数 */
  blankScreenDelay?: number;
}

/** 判断页面是否真的渲染出了可见内容 */
function hasVisibleContent(): boolean {
  const body = document.body;
  if (!body) return false;

  // 只看 body 的第一层子节点就够了：如果首屏有任何内容渲染出来，
  // 它一定会出现在这一层。不递归遍历是为了控制开销（白屏只检测一次）。
  const candidates = body.children;
  for (let i = 0; i < candidates.length; i += 1) {
    const el = candidates[i];
    if (!el || INVISIBLE_TAGS.has(el.tagName)) continue;
    // getClientRects 非空说明元素真的占据了布局空间。
    // 不能用 offsetHeight 判断，因为 display:contents 的元素高度为 0 但内容可见。
    if (el.getClientRects().length > 0) return true;
  }
  return false;
}

export function errorsIntegration(options: ErrorsIntegrationOptions = {}): Integration {
  const detectBlankScreen = options.detectBlankScreen ?? true;
  const delay = options.blankScreenDelay ?? BLANK_SCREEN_DELAY;

  return {
    name: 'errors',
    setup(client: PrismClient) {
      if (typeof window === 'undefined') return;

      // 1. JS 运行时错误 + 资源加载失败，共用一个监听器
      window.addEventListener(
        'error',
        (event: ErrorEvent) => {
          try {
            const target = event.target as
              | (Element & { src?: string; href?: string })
              | null;

            // event.target 是元素而不是 window，说明是资源加载失败
            if (target && target !== (window as unknown as Element) && target.tagName) {
              const resourceUrl = target.src ?? target.href ?? '';
              client.captureException(
                new Error(`资源加载失败：${target.tagName.toLowerCase()} ${resourceUrl}`),
                { kind: 'resource', source: resourceUrl },
              );
              return;
            }

            // 否则是 JS 运行时错误。优先用 event.error，拿不到再退化用 message
            client.captureException(event.error ?? new Error(event.message), { kind: 'js' });
          } catch (error) {
            // 采集逻辑自身出错时静默，绝不向上抛
            void error;
          }
        },
        true,
      );

      // 2. Promise 未捕获。这类错误不会触发上面的 error 事件，必须单独监听
      window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        try {
          client.captureException(event.reason, { kind: 'unhandledrejection' });
        } catch (error) {
          void error;
        }
      });

      // 3. 白屏检测
      if (!detectBlankScreen || typeof document === 'undefined') return;

      let reported = false;
      const checkBlankScreen = (): void => {
        try {
          if (reported || hasVisibleContent()) return;
          reported = true;
          client.captureException(new Error('页面疑似白屏：等待结束后仍未渲染出可见内容'), {
            kind: 'blank-screen',
            severity: 'fatal',
          });
        } catch (error) {
          void error;
        }
      };

      // 必须等 load 之后再开始计时，否则 SPA 还没渲染完就会被误判
      if (document.readyState === 'complete') {
        setTimeout(checkBlankScreen, delay);
      } else {
        window.addEventListener('load', () => setTimeout(checkBlankScreen, delay), {
          once: true,
        });
      }
    },
  };
}
