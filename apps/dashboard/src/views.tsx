import { useMemo, useState } from 'react';
import type { ErrorEvent, NetworkEvent, PerformanceEvent, PrismEvent } from '@prism/core';
import { METRIC_THRESHOLDS } from '@prism/core';
import { VirtualList } from './VirtualList';
import { LineChart } from './LineChart';
import { Waterfall } from './Waterfall';

const isError = (e: PrismEvent): e is ErrorEvent => e.type === 'error';
const isPerf = (e: PrismEvent): e is PerformanceEvent => e.type === 'performance';
const isNetwork = (e: PrismEvent): e is NetworkEvent => e.type === 'network';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 中位数比平均数更能反映「典型体验」，平均数会被少数极端值拉偏 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

// ---------------------------------------------------------------- 概览

export function Overview({ events }: { events: PrismEvent[] }): React.ReactElement {
  const stats = useMemo(() => {
    const errors = events.filter(isError);
    const perf = events.filter(isPerf);
    const networks = events.filter(isNetwork);
    const lcp = perf.filter((e) => e.name === 'LCP').map((e) => e.value);
    const cls = perf.filter((e) => e.name === 'CLS').map((e) => e.value);
    const slow = networks.filter((e) => e.duration > 1000).length;

    return {
      errorCount: errors.length,
      sessionCount: new Set(events.map((e) => e.sessionId)).size,
      lcpMedian: median(lcp),
      clsMedian: median(cls),
      requestCount: networks.length,
      slowCount: slow,
    };
  }, [events]);

  const lcpGood = METRIC_THRESHOLDS.LCP[0];

  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="k">错误总数</div>
          <div className="v" style={{ color: stats.errorCount > 0 ? '#d4537e' : undefined }}>
            {stats.errorCount}
          </div>
          <div className="s">含 JS 异常、资源失败、白屏</div>
        </div>
        <div className="card">
          <div className="k">会话数</div>
          <div className="v">{stats.sessionCount}</div>
          <div className="s">按 sessionId 去重</div>
        </div>
        <div className="card">
          <div className="k">LCP 中位数</div>
          <div className="v" style={{ color: stats.lcpMedian > lcpGood ? '#ef9f27' : '#1d9e75' }}>
            {Math.round(stats.lcpMedian)}
            <span style={{ fontSize: 14, marginLeft: 3 }}>ms</span>
          </div>
          <div className="s">达标线 {lcpGood}ms</div>
        </div>
        <div className="card">
          <div className="k">慢请求</div>
          <div className="v">{stats.slowCount}</div>
          <div className="s">共 {stats.requestCount} 个请求</div>
        </div>
      </div>

      <div className="panel">
        <h3>LCP 趋势</h3>
        <div className="body">
          {events.filter(isPerf).filter((e) => e.name === 'LCP').length > 0 ? (
            <LineChart
              points={events
                .filter(isPerf)
                .filter((e) => e.name === 'LCP')
                .map((e) => ({ x: e.timestamp, y: e.value }))}
              threshold={lcpGood}
            />
          ) : (
            <div className="hint">还没有 LCP 数据</div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- 错误

export function Errors({ events }: { events: PrismEvent[] }): React.ReactElement {
  const errors = useMemo(
    () => events.filter(isError).sort((a, b) => b.timestamp - a.timestamp),
    [events],
  );
  const [selected, setSelected] = useState<ErrorEvent | null>(null);

  if (errors.length === 0) {
    return <div className="empty">还没有捕获到错误</div>;
  }

  return (
    <>
      <div className="panel">
        <h3>错误列表 · {errors.length} 条（虚拟滚动，只渲染可视区）</h3>
        <VirtualList
          items={errors}
          height={460}
          keyOf={(item) => item.id}
          renderItem={(item) => (
            <div
              className="row"
              style={{ borderBottom: '1px solid var(--line)' }}
              onClick={() => setSelected(item)}
            >
              <span className={item.kind === 'js' ? 'tag' : 'tag bad'}>
                {item.kind === 'js' ? 'JS' : item.kind === 'resource' ? '资源' : item.kind === 'blank-screen' ? '白屏' : '异步'}
              </span>
              <span className="msg">{item.message}</span>
              <span className="time">{formatTime(item.timestamp)}</span>
            </div>
          )}
        />
      </div>

      {selected ? (
        <div className="panel">
          <h3>错误详情</h3>
          <div className="detail">
            <div style={{ marginBottom: 12, color: '#6b7280', fontSize: 13 }}>
              {formatTime(selected.timestamp)} · {selected.kind} · {selected.url}
            </div>
            <pre>{selected.stack || selected.message}</pre>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              报错前的操作轨迹（{selected.breadcrumbs.length} 条）
            </div>
            {selected.breadcrumbs.length === 0 ? (
              <div className="hint" style={{ padding: 0 }}>
                没有面包屑。启用 breadcrumbsIntegration 后可以回溯用户操作。
              </div>
            ) : (
              selected.breadcrumbs.map((crumb, i) => (
                <div className="crumb" key={i}>
                  <span className="t">{formatTime(crumb.timestamp)}</span>
                  <span className="c">{crumb.category}</span>
                  <span>{crumb.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- 性能

export function Performance({ events }: { events: PrismEvent[] }): React.ReactElement {
  const perf = useMemo(() => events.filter(isPerf), [events]);
  const names = ['FCP', 'LCP', 'CLS', 'INP', 'TTFB'] as const;

  if (perf.length === 0) {
    return <div className="empty">还没有性能数据</div>;
  }

  return (
    <>
      {names.map((name) => {
        const series = perf.filter((e) => e.name === name);
        if (series.length === 0) return null;
        const good = METRIC_THRESHOLDS[name][0];
        return (
          <div className="panel" key={name}>
            <h3>
              {name} · 中位数 {Math.round(median(series.map((e) => e.value)))}
              {name === 'CLS' ? '' : 'ms'}
            </h3>
            <div className="body">
              <LineChart
                points={series.map((e) => ({ x: e.timestamp, y: e.value }))}
                threshold={good}
                unit={name === 'CLS' ? '' : 'ms'}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- 网络

export function Network({ events }: { events: PrismEvent[] }): React.ReactElement {
  const networks = useMemo(
    () => events.filter(isNetwork).sort((a, b) => a.timestamp - b.timestamp),
    [events],
  );

  return (
    <div className="panel">
      <h3>资源瀑布图 · {networks.length} 个请求</h3>
      <Waterfall events={networks} />
    </div>
  );
}
