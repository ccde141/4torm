/**
 * 等高线动态背景 — 纯函数
 *
 * 抽自 desktop/等高线v1.0.html，做了几点工程化：
 * - 高度场算法不变（8 层 sin/cos 相位流动）
 * - 每帧重建 grid 并 marching squares 输出线段
 * - 与 React 解耦，仅暴露 height() / drawContours() 两个纯函数
 *
 * 性能注意：调用方负责帧率控制（idle 降频 + visibilityState 暂停）。
 */

import type { ContourParams } from '../store/skin';

/**
 * 高度场。
 * 8 层不同方向、不同频率、不同时间相位的 sin/cos 叠加。
 *
 * @param x 像素坐标
 * @param y 像素坐标
 * @param t 时间累计值（外部按 speed 增量推进）
 * @param w 画布宽度
 * @param h 画布高度
 * @param peaks 峰数
 * @param rough 粗糙度（→ 内部映射为高频系数）
 */
export function height(
  x: number, y: number, t: number,
  w: number, h: number,
  peaks: number, rough: number,
): number {
  const nx = x / w;
  const ny = y / h;
  const p = peaks;
  const r = 0.3 + (rough - 1) / 24 * 2.6;

  return (
    Math.sin(nx * p * 1.2 + t * 0.8) * 0.22 +
    Math.cos(ny * p * 1.1 - t * 0.65) * 0.20 +
    Math.sin((nx + ny) * p * 0.9 + t * 0.7) * 0.18 +
    Math.cos((nx - ny) * p * 0.8 - t * 0.6) * 0.16 +
    Math.sin(nx * p * r + ny * p * 0.5 + t * 1.2) * 0.12 +
    Math.cos(nx * p * 0.5 - ny * p * r - t * 0.9) * 0.10 +
    Math.sin(nx * p * 0.7 + ny * p * 0.7 + t * 0.5) * 0.08 +
    Math.cos(nx * p * 1.0 - ny * p * 0.3 + t * 0.4) * 0.06
  );
}

/** 边缘距离衰减（让靠近 viewport 边缘的等高线变淡） */
function getEdgeFadeAlpha(p1: [number, number], p2: [number, number], w: number, h: number, baseAlpha: number): number {
  const mx = (p1[0] + p2[0]) * 0.5;
  const my = (p1[1] + p2[1]) * 0.5;
  const dxToEdge = Math.min(mx, w - mx);
  const dyToEdge = Math.min(my, h - my);
  const distToEdge = Math.min(dxToEdge, dyToEdge);
  const edgeFade = Math.min(1.0, distToEdge / 120);
  return baseAlpha * (0.75 + edgeFade * 0.25);
}

/**
 * Marching squares 绘制等高线。
 * 颜色梯度从冷青 → 暖青（按 height level 线性插值）。
 *
 * @param ctx canvas 2D context
 * @param grid 高度网格（rows × cols）
 * @param step 网格步长（px）
 * @param cols 列数
 * @param rows 行数
 * @param w 画布宽度
 * @param h 画布高度
 * @param params 用户参数（interval / alpha / lwidth）
 */
export function drawContours(
  ctx: CanvasRenderingContext2D,
  grid: number[][], step: number, cols: number, rows: number,
  w: number, h: number,
  params: Pick<ContourParams, 'interval' | 'alpha' | 'lwidth'>,
): void {
  const intervalVal = params.interval * 0.004;
  const levels: number[] = [];
  for (let l = -0.8; l <= 0.8; l += intervalVal) levels.push(l);
  const alphaBaseRaw = Math.min(0.85, Math.max(0.08, params.alpha * 0.012));
  const lineWidthVal = Math.max(0.4, params.lwidth * 0.12);

  for (let idx = 0; idx < levels.length; idx++) {
    const level = levels[idx];
    const norm = (level + 0.8) / 1.6;
    const r = Math.round(20 + norm * 50);
    const g = Math.round(160 - norm * 50);
    const b = Math.round(200 - norm * 60);
    const baseColor = `rgba(${r}, ${g}, ${b}, `;

    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const x = i * step, y = j * step;
        const v00 = grid[j][i] - level;
        const v10 = grid[j][i + 1] - level;
        const v01 = grid[j + 1][i] - level;
        const v11 = grid[j + 1][i + 1] - level;
        const idxCase = (v00 > 0 ? 8 : 0) | (v10 > 0 ? 4 : 0) | (v11 > 0 ? 2 : 0) | (v01 > 0 ? 1 : 0);
        if (idxCase === 0 || idxCase === 15) continue;

        const lerp = (a: number, b: number, va: number, vb: number) => a + (b - a) * (-va / (vb - va));
        const pts: Record<string, [number, number]> = {
          t: [lerp(x, x + step, v00, v10), y],
          r: [x + step, lerp(y, y + step, v10, v11)],
          b: [lerp(x, x + step, v01, v11), y + step],
          l: [x, lerp(y, y + step, v00, v01)],
        };

        const segPairs = getSegments(idxCase, pts);
        if (!segPairs) continue;

        for (let k = 0; k < segPairs.length; k += 2) {
          const p1 = segPairs[k];
          const p2 = segPairs[k + 1];
          const alpha = getEdgeFadeAlpha(p1, p2, w, h, alphaBaseRaw);
          ctx.beginPath();
          ctx.moveTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
          ctx.strokeStyle = baseColor + alpha + ')';
          ctx.lineWidth = lineWidthVal;
          ctx.stroke();
        }
      }
    }
  }
}

/** 根据 marching squares case 返回端点对（按原 HTML 的 edgesMap 还原） */
function getSegments(idxCase: number, pts: Record<string, [number, number]>): [number, number][] | null {
  switch (idxCase) {
    case 1: return [pts.b, pts.l];
    case 2: return [pts.r, pts.b];
    case 3: return [pts.r, pts.l];
    case 4: return [pts.t, pts.r];
    case 5: return [pts.t, pts.r, pts.b, pts.l];
    case 6: return [pts.t, pts.b];
    case 7: return [pts.t, pts.l];
    case 8: return [pts.t, pts.l];
    case 9: return [pts.t, pts.b];
    case 10: return [pts.t, pts.l, pts.r, pts.b];
    case 11: return [pts.t, pts.r];
    case 12: return [pts.r, pts.l];
    case 13: return [pts.r, pts.b];
    case 14: return [pts.b, pts.l];
    default: return null;
  }
}

/** 一帧渲染：构造 grid + 调 drawContours */
export function renderContourFrame(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, t: number,
  params: ContourParams,
): void {
  // 透明画布：不画底色，让等高线叠在 body 背景之上、#root 之下
  ctx.clearRect(0, 0, w, h);

  const step = 6;
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const grid: number[][] = [];
  for (let j = 0; j < rows; j++) {
    grid[j] = [];
    for (let i = 0; i < cols; i++) {
      grid[j][i] = height(i * step, j * step, t, w, h, params.peaks, params.rough);
    }
  }
  drawContours(ctx, grid, step, cols, rows, w, h, params);
}
