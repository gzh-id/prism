import { useCallback, useEffect, useState } from 'react';
import { readAllEvents, importCompressedReport } from '@prism/core';
import type { PrismEvent } from '@prism/core';

/** 单文件报告把压缩数据内嵌在这个全局变量上，离线打开时从这里读 */
const EMBEDDED_KEY = '__PRISM_PAYLOAD__' as const;

/**
 * 读取内嵌数据。
 *
 * 为什么要这一层：导出的 .html 要在别人电脑上、断网状态下打开。
 * 那时候没有 IndexedDB（数据在导出者的机器里），只能靠内嵌在文件里的压缩数据。
 * 没有这个分支，导出的报告打开就是一片空白 —— 功能等于没做。
 */
async function readEmbeddedEvents(): Promise<PrismEvent[] | null> {
  const payload = (window as unknown as Record<string, unknown>)[EMBEDDED_KEY];
  if (typeof payload !== 'string' || payload.length === 0) return null;

  try {
    const report = await importCompressedReport(payload);
    return report.events;
  } catch {
    // 数据损坏或版本不匹配时降级为「没有数据」，而不是白屏崩溃
    return null;
  }
}

/**
 * 事件数据源。优先用内嵌数据（离线报告场景），否则读本地 IndexedDB。
 */
export function usePrismEvents(): {
  events: PrismEvent[];
  loading: boolean;
  /** 数据来自导出的报告而不是本地库。UI 要据此提示用户 */
  fromReport: boolean;
  reload: () => void;
} {
  const [events, setEvents] = useState<PrismEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromReport, setFromReport] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // 组件可能在数据返回前卸载，这时候再 setState 会触发 React 警告，
    // 也是内存泄漏的常见来源，所以要用标记位取消
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const embedded = await readEmbeddedEvents();
      if (cancelled) return;
      if (embedded) {
        setEvents(embedded);
        setFromReport(true);
        setLoading(false);
        return;
      }

      try {
        const list = await readAllEvents();
        if (cancelled) return;
        setEvents(list);
        setFromReport(false);
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { events, loading, fromReport, reload };
}
