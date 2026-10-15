import { useEffect, useRef, useState } from 'react';
import type { NetworkEvent } from '@prism/core';

/**
 * 手写资源瀑布图
 *
 * 为什么这个图最有用：它把「慢」拆成了可归因的几段。
 * 看到一条请求慢，你立刻能知道是 DNS 慢、连接慢、服务器响应慢，还是资源太大。
 * 只看总耗时的话，你只能猜。
 *
 * 用 Canvas 而不是 DOM：一个页面几百个请求，每个请求 5 段，
 * 用 DOM 就是上千个节点，滚动会掉帧。Canvas 一次绘制搞定。
 */

const ROW_HEIGHT = 24;
const HEADER = 34;
const LABEL_WIDTH = 210;

const SEGMENTS = [
  { key: 'dns', label: 'DNS', color: '#b4b2a9' },
  { key: 'tcp', label: 'TCP', color: '#378add' },
  { key: 'ssl', label: 'SSL', color: '#7f77dd' },
  { key: 'ttfb', label: '等待响应', color: '#ef9f27' },
  { key: 'download', label: '下载', color: '#1d9e75' },
] as const;

interface Props {
  events: NetworkEvent[];
}

export function Waterfall({ events }: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const height = HEADER + events.length * ROW_HEIGHT + 8;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const cssWidth = canvas.clientWidth || 800;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, height);

    if (events.length === 0) return;

    // 请求开始时间要反推：事件记录的是「请求结束的时刻」
    const starts = events.map((e) => e.timestamp - e.duration);
    const ends = events.map((e) => e.timestamp);
    const minStart = Math.min(...starts);
    const maxEnd = Math.max(...ends);
    const total = Math.max(1, maxEnd - minStart);

    const plotW = Math.max(50, cssWidth - LABEL_WIDTH - 20);
    const scale = plotW / total;

    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';

    events.forEach((event, index) => {
      const y = HEADER + index * ROW_HEIGHT;
      const isHover = hovered === index;
      if (isHover) {
        ctx.fillStyle = '#eeedfe';
        ctx.fillRect(0, y, cssWidth, ROW_HEIGHT);
      }

      // 左侧：URL 与耗时
      ctx.fillStyle = event.ok ? '#1a1a1a' : '#d4537e';
      ctx.textAlign = 'left';
      const label = event.url.replace(/^https?:\/\//, '').slice(0, 34);
      ctx.fillText(label, 10, y + ROW_HEIGHT / 2);

      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(event.duration)}ms`, LABEL_WIDTH - 8, y + ROW_HEIGHT / 2);

      // 右侧：分段条
      const startX = LABEL_WIDTH + ((starts[index] as number) - minStart) * scale;
      const barY = y + 6;
      const barH = ROW_HEIGHT - 12;

      if (!event.timing) {
        // 拿不到阶段数据时（跨域资源常见）画一条整条，不编造分段
        ctx.fillStyle = '#d3d1c7';
        ctx.fillRect(startX, barY, Math.max(2, event.duration * scale), barH);
        return;
      }

      let cursor = startX;
      for (const segment of SEGMENTS) {
        const value = event.timing[segment.key];
        if (value <= 0) continue;
        const width = Math.max(1, value * scale);
        ctx.fillStyle = segment.color;
        ctx.fillRect(cursor, barY, width, barH);
        cursor += width;
      }
    });

    // 顶部时间刻度
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i += 1) {
      const value = (total * i) / 4;
      const x = LABEL_WIDTH + value * scale;
      ctx.fillText(`${Math.round(value)}ms`, x, HEADER / 2);
      ctx.strokeStyle = '#f2f2f7';
      ctx.beginPath();
      ctx.moveTo(x, HEADER - 6);
      ctx.lineTo(x, height - 4);
      ctx.stroke();
    }
  }, [events, height, hovered]);

  if (events.length === 0) {
    return <div className="hint">还没有网络数据。接入 SDK 后刷新页面即可看到。</div>;
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 14, padding: '8px 12px', fontSize: 12, color: '#6b7280' }}>
        {SEGMENTS.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <i
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: s.color,
                display: 'inline-block',
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height, display: 'block' }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const y = event.clientY - rect.top;
          const index = Math.floor((y - HEADER) / ROW_HEIGHT);
          setHovered(index >= 0 && index < events.length ? index : null);
        }}
        onMouseLeave={() => setHovered(null)}
      />
      {hovered !== null && events[hovered] ? (
        <div
          style={{
            position: 'absolute',
            left: 12,
            top: HEADER + (hovered + 1) * ROW_HEIGHT + 4,
            background: '#1a1a1a',
            color: '#fff',
            fontSize: 12,
            padding: '8px 12px',
            borderRadius: 8,
            pointerEvents: 'none',
            maxWidth: 560,
            wordBreak: 'break-all',
            zIndex: 5,
          }}
        >
          <div>{events[hovered].url}</div>
          <div style={{ opacity: 0.75, marginTop: 4 }}>
            {events[hovered].method} · 状态 {events[hovered].status} · 耗时{' '}
            {Math.round(events[hovered].duration)}ms
          </div>
        </div>
      ) : null}
    </div>
  );
}
