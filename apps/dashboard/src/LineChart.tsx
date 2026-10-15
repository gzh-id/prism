import { useEffect, useRef } from 'react';

/**
 * 手写 Canvas 时序折线图
 *
 * 为什么用 Canvas 而不是 SVG：数据量上千后，SVG 每个点都是一个 DOM 节点，
 * 浏览器光是维护这些节点就会卡住。Canvas 只有 1 个节点，绘制成本与数据量线性相关。
 *
 * 两个必须处理的细节：
 * 1. **devicePixelRatio**。Canvas 的 CSS 尺寸和绘图缓冲区尺寸是两回事，
 *    不按 DPR 放大缓冲区的话，2x 屏上画出来的线是模糊的。
 * 2. **LTTB 降采样**。屏幕横向只有几百个像素，却要画几万个点，绝大部分点是浪费的。
 *    LTTB 的特点是「保留视觉形状」而不是简单抽稀 —— 峰值不会被抹掉，
 *    这点对监控图表很关键，因为尖峰恰恰是你要看的东西。
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * LTTB（Largest-Triangle-Three-Buckets）降采样。
 * 原理：把数据分桶，每桶选一个点，选择标准是「与前后两点构成的三角形面积最大」，
 * 面积最大意味着这个点最能代表局部的形状特征。
 */
export function lttb(data: Point[], threshold: number): Point[] {
  if (threshold >= data.length || threshold <= 2) return data;

  const sampled: Point[] = [data[0] as Point];
  const bucketSize = (data.length - 2) / (threshold - 2);
  let a = 0;

  for (let i = 0; i < threshold - 2; i += 1) {
    // 下一个桶的平均点，用来构成三角形
    const nextStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length);
    let avgX = 0;
    let avgY = 0;
    const avgCount = Math.max(1, nextEnd - nextStart);
    for (let j = nextStart; j < nextEnd; j += 1) {
      avgX += data[j]?.x ?? 0;
      avgY += data[j]?.y ?? 0;
    }
    avgX /= avgCount;
    avgY /= avgCount;

    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.floor((i + 1) * bucketSize) + 1;

    const pointA = data[a] as Point;
    let maxArea = -1;
    let best = rangeStart;

    for (let j = rangeStart; j < rangeEnd && j < data.length; j += 1) {
      const point = data[j] as Point;
      // 用叉积算三角形面积，省掉开方
      const area = Math.abs(
        (pointA.x - avgX) * (point.y - pointA.y) - (pointA.x - point.x) * (avgY - pointA.y),
      );
      if (area > maxArea) {
        maxArea = area;
        best = j;
      }
    }

    sampled.push(data[best] as Point);
    a = best;
  }

  sampled.push(data[data.length - 1] as Point);
  return sampled;
}

interface Props {
  points: Point[];
  color?: string;
  height?: number;
  /** 达标线，画一条虚线参考 */
  threshold?: number;
  unit?: string;
}

export function LineChart({
  points,
  color = '#534ab7',
  height = 220,
  threshold,
  unit = 'ms',
}: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length === 0) return;

    const cssWidth = canvas.clientWidth || 600;
    const dpr = window.devicePixelRatio || 1;

    // 缓冲区按 DPR 放大，再用 CSS 缩回去，这样在高分屏上是清晰的
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, height);

    const padding = { top: 16, right: 16, bottom: 26, left: 46 };
    const plotW = cssWidth - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = 0;
    const maxY = Math.max(...ys, threshold ?? 0) * 1.15 || 1;

    const toX = (x: number) =>
      padding.left + (maxX === minX ? plotW / 2 : ((x - minX) / (maxX - minX)) * plotW);
    const toY = (y: number) => padding.top + plotH - ((y - minY) / (maxY - minY)) * plotH;

    // 坐标轴
    ctx.strokeStyle = '#e8e8ef';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + plotH);
    ctx.lineTo(padding.left + plotW, padding.top + plotH);
    ctx.stroke();

    // Y 轴刻度
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i += 1) {
      const value = minY + ((maxY - minY) * i) / 4;
      const y = toY(value);
      ctx.fillText(`${Math.round(value)}`, padding.left - 8, y + 4);
      ctx.strokeStyle = '#f2f2f7';
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + plotW, y);
      ctx.stroke();
    }

    // 达标参考线
    if (threshold !== undefined) {
      ctx.strokeStyle = '#ef9f27';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, toY(threshold));
      ctx.lineTo(padding.left + plotW, toY(threshold));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 降采样后再画，屏幕上最多几百个像素宽，画更多点是浪费
    const drawPoints = lttb(
      points.map((p) => ({ x: toX(p.x), y: toY(p.y) })),
      Math.min(points.length, Math.floor(plotW)),
    );

    // 面积填充
    const gradientSafe = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
    gradientSafe.addColorStop(0, `${color}22`);
    gradientSafe.addColorStop(1, `${color}02`);
    ctx.fillStyle = gradientSafe;
    ctx.beginPath();
    ctx.moveTo(drawPoints[0]?.x ?? 0, padding.top + plotH);
    for (const p of drawPoints) ctx.lineTo(p.x, p.y);
    ctx.lineTo(drawPoints[drawPoints.length - 1]?.x ?? 0, padding.top + plotH);
    ctx.closePath();
    ctx.fill();

    // 折线
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    drawPoints.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // 单位标注
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'left';
    ctx.fillText(unit, padding.left + 2, padding.top - 4);
  }, [points, color, height, threshold, unit]);

  return <canvas ref={canvasRef} style={{ width: '100%', height }} />;
}
