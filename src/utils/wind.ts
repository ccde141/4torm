/**
 * 风线动态背景 — 纯函数
 *
 * 抽自 desktop/deepseek 风线.html，做了几点工程化：
 * - 波形算法完整保留（平行组共享基波 + 随机组独立）
 * - 线条配置（lineProfiles）持久化：仅线条数变化时重建，
 *   其余参数微调不重建（否则波形每帧跳变）
 * - 透明画布 clearRect（与等高线一致，叠在 body 背景上、#root 之下）
 * - titleY → centerY（与不存在的标题解耦），删 fontSize
 *
 * 性能注意：调用方负责帧率控制（idle 降频 + visibilityState 暂停）。
 */

import type { WindParams } from '../store/skin';

/** 单条线的波形 + 减淡配置 */
export interface LineProfile {
  type: 'parallel' | 'random';
  offset: number;
  f1: number; f2: number; f3: number;
  p1: number; p2: number; p3: number;
  speed1: number; speed2: number;
  colorIdx: number;
  alphaRandom: number;  // 随机减淡因子，由 fadeIntensity 控制
}

/** 平行组共享基础波形特性 */
const BASE_WAVE = {
  f1_base: 1.22,
  f2_base: 0.85,
  f3_base: 0.58,
  s1_shared: 0.94,
  s2_shared: -0.72,
};

/** 增强亮度色盘（青 / 蓝 / 白）— 固定，不跟随皮肤色 */
const COLOR_PALETTE = [
  '#00f7f0', '#30c0ff', '#70b0ff', '#00e0d0', '#4ab5ff', '#1ad9e6', '#8adcff',
];

/**
 * 重算所有线条的随机减淡因子。
 * 强度 0~100 → 因子范围 [1 - intensity/100*0.65, 1]。
 * intensity=0 → 全 1（无减淡）；intensity=100 → 0.35~1（差异最大）。
 */
export function recalcFadeFactors(profiles: LineProfile[], fadeIntensity: number): void {
  const intensity = Math.min(100, Math.max(0, fadeIntensity)) / 100;
  const minFactor = 1 - intensity * 0.65;
  for (let i = 0; i < profiles.length; i++) {
    profiles[i].alphaRandom = minFactor + Math.random() * (1 - minFactor);
  }
}

/** 构造一条平行组线 */
function buildParallelLine(i: number, paraNum: number): LineProfile {
  const offsetRatio = paraNum === 1 ? 0 : (i / (paraNum - 1)) * 2 - 1;
  return {
    type: 'parallel',
    offset: offsetRatio,
    f1: BASE_WAVE.f1_base * (0.87 + Math.random() * 0.26),
    f2: BASE_WAVE.f2_base * (0.87 + Math.random() * 0.26),
    f3: BASE_WAVE.f3_base * (0.87 + Math.random() * 0.26),
    p1: (Math.random() - 0.5) * 0.72,
    p2: (Math.random() - 0.5) * 0.62,
    p3: (Math.random() - 0.5) * 0.5,
    speed1: BASE_WAVE.s1_shared + (Math.random() - 0.5) * 0.045,
    speed2: BASE_WAVE.s2_shared + (Math.random() - 0.5) * 0.045,
    colorIdx: i % COLOR_PALETTE.length,
    alphaRandom: 1.0,
  };
}

/** 构造一条随机组线（完全独立随机） */
function buildRandomLine(): LineProfile {
  return {
    type: 'random',
    offset: Math.random() * 2 - 1,
    f1: 0.65 + Math.random() * 2.4,
    f2: 0.4 + Math.random() * 1.9,
    f3: 0.25 + Math.random() * 1.2,
    p1: Math.random() * Math.PI * 2,
    p2: Math.random() * Math.PI * 2,
    p3: Math.random() * Math.PI * 2,
    speed1: (Math.random() > 0.5 ? 1 : -1) * (0.45 + Math.random() * 1.0),
    speed2: (Math.random() > 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.9),
    colorIdx: Math.floor(Math.random() * COLOR_PALETTE.length),
    alphaRandom: 1.0,
  };
}

/**
 * 重建所有线条配置（仅在 totalLines / parallelCount 变化时调用）。
 * 平行组共享基波，随机组独立，轻微打乱顺序后按强度生成减淡因子。
 */
export function buildLineProfiles(params: WindParams): LineProfile[] {
  const total = Math.max(1, params.totalLines);
  let paraNum = Math.min(params.parallelCount, total);
  paraNum = Math.max(0, paraNum);
  const randomNum = total - paraNum;
  const profiles: LineProfile[] = [];

  for (let i = 0; i < paraNum; i++) profiles.push(buildParallelLine(i, paraNum));
  for (let i = 0; i < randomNum; i++) profiles.push(buildRandomLine());

  // 轻微打乱顺序，让层次更自然
  for (let i = profiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [profiles[i], profiles[j]] = [profiles[j], profiles[i]];
  }

  recalcFadeFactors(profiles, params.fadeIntensity);
  return profiles;
}

/** 计算某条线在归一化横坐标 nx 处的纵向波动量 */
function computeWaveY(cfg: LineProfile, nx: number, t: number, amp: number): number {
  if (cfg.type === 'parallel') {
    return (
      Math.sin(nx * cfg.f1 * 8.2 + t * cfg.speed1 + cfg.p1) * amp * 0.52 +
      Math.cos(nx * cfg.f2 * 5.5 - t * cfg.speed2 + cfg.p2) * amp * 0.32 +
      Math.sin(nx * cfg.f3 * 3.9 + t * 0.42 + cfg.p3) * amp * 0.19
    );
  }
  return (
    Math.sin(nx * cfg.f1 * 9.5 + t * cfg.speed1 + cfg.p1) * amp * 0.56 +
    Math.cos(nx * cfg.f2 * 6.7 - t * cfg.speed2 + cfg.p2) * amp * 0.30 +
    Math.sin(nx * cfg.f3 * 4.4 + t * 0.58 + cfg.p3) * amp * 0.16
  );
}

/** 绘制单条线 */
function drawLine(
  ctx: CanvasRenderingContext2D,
  cfg: LineProfile, baseY: number, finalAlpha: number,
  w: number, t: number, ampVal: number, lineWidthVal: number,
): void {
  ctx.beginPath();
  ctx.globalAlpha = finalAlpha;
  ctx.lineWidth = lineWidthVal;
  ctx.strokeStyle = COLOR_PALETTE[cfg.colorIdx % COLOR_PALETTE.length];
  ctx.lineCap = 'round';

  const step = Math.max(2.2, Math.floor(w / 450));
  let first = true;
  for (let x = -20; x <= w + 20; x += step) {
    const yCurve = baseY + computeWaveY(cfg, x / w, t, ampVal);
    if (first) { ctx.moveTo(x, yCurve); first = false; }
    else ctx.lineTo(x, yCurve);
  }
  ctx.stroke();
}

/**
 * 一帧渲染：透明清屏 + 遍历 profiles 绘制每条线。
 *
 * @param profiles 持久化的线条配置（由 buildLineProfiles 生成）
 */
export function renderWindFrame(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, t: number,
  params: WindParams, profiles: LineProfile[],
): void {
  // 透明画布：叠在 body 背景之上、#root 之下（与等高线一致）
  ctx.clearRect(0, 0, w, h);

  const centerBase = h * (params.centerY / 100);
  const spreadVal = params.spread;
  const ampVal = params.amplitude;
  const globalAlphaBase = Math.min(0.88, Math.max(0.18, params.alpha * 0.017));
  const lineWidthVal = Math.max(0.8, params.lineWidth * 0.12);

  for (let idx = 0; idx < profiles.length; idx++) {
    const cfg = profiles[idx];
    const baseY = centerBase + cfg.offset * spreadVal;
    const depthFactor = 1 - Math.min(0.4, Math.abs(cfg.offset) * 0.25);
    let finalAlpha = globalAlphaBase * depthFactor * cfg.alphaRandom;
    finalAlpha = Math.min(0.92, Math.max(0.12, finalAlpha));
    drawLine(ctx, cfg, baseY, finalAlpha, w, t, ampVal, lineWidthVal);
  }
  ctx.globalAlpha = 1;
}
