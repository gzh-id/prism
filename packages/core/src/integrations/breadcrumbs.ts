import type { Breadcrumb, Integration, PrismClient } from '@prism/shared';

/**
 * 面包屑插件 —— 记录用户报错前做过什么
 *
 * 这是整个项目最实用的功能：只有堆栈时你看到的是「哪里错了」，
 * 有了面包屑你才知道「用户是怎么走到这里的」。后者才是复现问题的关键。
 *
 * 设计取舍：
 * - 只记录「发生了什么」的元信息，不记录 DOM 内容。用户的输入内容属于隐私，不碰。
 * - 点击用捕获阶段监听，这样组件内部 stopPropagation 也不会漏掉。
 * - 路由变化靠 monkey patch history，因为 SPA 切换路由不会触发任何原生事件。
 */

/** 把 DOM 元素压缩成一个可读的选择器，体积优先，够用就行 */
function describeElement(el: Element | null): string {
  if (!el) return 'unknown';
  const tag = el.tagName?.toLowerCase() ?? 'unknown';
  const id = el.id ? `#${el.id}` : '';
  let cls = '';
  if (typeof el.className === 'string' && el.className.trim()) {
    cls = `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`;
  }
  return `${tag}${id}${cls}`;
}

function add(
  client: PrismClient,
  breadcrumb: Omit<Breadcrumb, 'timestamp'>,
): void {
  try {
    client.addBreadcrumb(breadcrumb);
  } catch {
    // 记面包屑失败无所谓，不能因此影响用户操作
  }
}

export function breadcrumbsIntegration(): Integration {
  return {
    name: 'breadcrumbs',
    setup(client: PrismClient) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;

      // 1. 点击
      document.addEventListener(
        'click',
        (event: MouseEvent) => {
          const el = event.target as Element | null;
          add(client, {
            category: 'click',
            level: 'info',
            message: `点击 ${describeElement(el)}`,
            data: { tag: el?.tagName?.toLowerCase() ?? '' },
          });
        },
        true,
      );

      // 2. SPA 路由变化
      const historyObj = window.history;
      if (historyObj && typeof historyObj.pushState === 'function') {
        const originalPush = historyObj.pushState;
        const originalReplace = historyObj.replaceState;

        const patch = (original: typeof historyObj.pushState, action: string) =>
          function patched(
            this: History,
            ...args: Parameters<typeof historyObj.pushState>
          ) {
            const url = typeof args[2] === 'string' ? args[2] : location.pathname;
            add(client, {
              category: 'navigation',
              level: 'info',
              message: `${action} ${url}`,
            });
            return original.apply(this, args);
          };

        historyObj.pushState = patch(originalPush, '前进到');
        historyObj.replaceState = patch(originalReplace, '替换为');
      }

      window.addEventListener('popstate', () => {
        add(client, {
          category: 'navigation',
          level: 'info',
          message: `后退到 ${location.pathname}`,
        });
      });

      // 3. 生命周期，用来判断「报错发生在页面加载的哪个阶段」
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          add(client, {
            category: 'lifecycle',
            level: 'info',
            message: 'DOM 解析完成',
          });
        });
      }
      window.addEventListener('load', () => {
        add(client, { category: 'lifecycle', level: 'info', message: '页面加载完成' });
      });
      window.addEventListener('pagehide', () => {
        add(client, { category: 'lifecycle', level: 'info', message: '页面隐藏' });
      });
    },
  };
}
