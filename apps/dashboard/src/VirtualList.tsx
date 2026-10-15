import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * 手写虚拟滚动 —— 支持变高行
 *
 * 为什么不用现成库：这是本项目要在面试里讲的核心实现之一，必须自己写。
 *
 * 三个关键点（面试官必问）：
 * 1. **为什么只渲染可视区**：1 万条数据如果全渲染成 DOM，光是节点创建就要几秒，
 *    滚动时每帧都要重排。虚拟滚动把 DOM 节点数恒定在「可视区条数 + overscan」。
 * 2. **为什么必须缓存行高**：变高行没法用 index 直接算出偏移量，
 *    只能一边渲染一边测量、把结果缓存进前缀和数组。不缓存的话每次滚动都要重算全部。
 * 3. **overscan 是什么**：在可视区上下多渲染几条。
 *    滚动不是逐像素触发的，一次可能跳几十像素，不预留就会先看到白块再补上内容。
 */

interface Props<T> {
  items: T[];
  /** 行高估算值。真实高度会在渲染后被测量并覆盖 */
  estimatedHeight?: number;
  /** 可视区上下各多渲染几条，用来消除快速滚动时的白块 */
  overscan?: number;
  height?: number;
  keyOf: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
}

export function VirtualList<T>({
  items,
  estimatedHeight = 62,
  overscan = 6,
  height = 520,
  keyOf,
  renderItem,
}: Props<T>): React.ReactElement {
  const [scrollTop, setScrollTop] = useState(0);
  // 测量到真实高度后需要强制重算前缀和，用一个自增标记触发
  const [measureTick, setMeasureTick] = useState(0);

  /** 已测得的真实行高，未测过的用估算值兜底 */
  const measured = useRef<number[]>([]);
  const nodes = useRef(new Map<number, HTMLDivElement>());

  /** 前缀和：offsets[i] 表示第 i 条之前的累计高度，用它把「滚动位置」换算成「第几条」 */
  const offsets = useMemo(() => {
    const arr = new Array<number>(items.length + 1);
    arr[0] = 0;
    for (let i = 0; i < items.length; i += 1) {
      arr[i + 1] = arr[i] + (measured.current[i] ?? estimatedHeight);
    }
    return arr;
    // measureTick 是刻意的额外依赖：测量完成后必须重算
  }, [items, estimatedHeight, measureTick]);

  const totalHeight = offsets[items.length] ?? 0;

  /** 二分查找：找到滚动位置落在哪一行。不能用遍历，万行数据下会掉帧 */
  const findIndex = useCallback(
    (target: number): number => {
      let lo = 0;
      let hi = items.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= target) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    [offsets, items.length],
  );

  const startIndex = Math.max(0, findIndex(scrollTop) - overscan);
  const endIndex = Math.min(items.length, findIndex(scrollTop + height) + overscan + 1);

  /**
   * 渲染后测量真实高度。
   * 用 useLayoutEffect 而不是 useEffect：必须在浏览器绘制前完成修正，
   * 否则用户会看到一帧「位置错乱再跳回来」的闪烁。
   */
  useLayoutEffect(() => {
    let changed = false;
    nodes.current.forEach((node, index) => {
      const real = node.offsetHeight;
      if (real > 0 && measured.current[index] !== real) {
        measured.current[index] = real;
        changed = true;
      }
    });
    if (changed) setMeasureTick((t) => t + 1);
  });

  const visible: React.ReactNode[] = [];
  for (let i = startIndex; i < endIndex; i += 1) {
    const item = items[i];
    if (item === undefined) continue;
    visible.push(
      <div
        key={keyOf(item, i)}
        ref={(node) => {
          if (node) nodes.current.set(i, node);
          else nodes.current.delete(i);
        }}
        style={{ position: 'absolute', top: offsets[i], left: 0, right: 0 }}
      >
        {renderItem(item, i)}
      </div>,
    );
  }

  return (
    <div
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{
        height,
        overflowY: 'auto',
        position: 'relative',
        borderTop: '1px solid var(--line)',
      }}
    >
      {/* 用一个撑高的空 div 让滚动条长度正确，这是虚拟滚动的标准做法 */}
      <div style={{ height: totalHeight, position: 'relative' }}>{visible}</div>
    </div>
  );
}
