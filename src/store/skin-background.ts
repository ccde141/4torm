/**
 * 动态背景配置类型 & 常量
 *
 * 拆自 store/skin.ts，避免主文件超 300 行。
 */

/** 动态背景类型 */
export type BackgroundType = 'none' | 'contour' | 'wind';

/** 等高线背景参数 */
export interface ContourParams {
  speed: number;     // 1-60
  peaks: number;     // 2-25
  interval: number;  // 2-35
  alpha: number;     // 5-80
  rough: number;     // 1-25
  lwidth: number;    // 2-35
}

export const CONTOUR_DEFAULTS: ContourParams = {
  speed: 8, peaks: 7, interval: 8, alpha: 22, rough: 5, lwidth: 9,
};

export const CONTOUR_RECOMMENDED: ContourParams = {
  speed: 15, peaks: 12, interval: 6, alpha: 32, rough: 9, lwidth: 14,
};

/** 风线背景参数（迁移自 desktop/deepseek 风线.html，titleY→centerY，删 fontSize） */
export interface WindParams {
  speed: number;          // 1-38   动画速度
  totalLines: number;     // 4-52   总线条数（变化触发重建）
  parallelCount: number;  // 0-36   平行线数量（变化触发重建）
  spread: number;         // 30-340 聚集范围（覆盖幅度）
  amplitude: number;      // 15-180 弯曲度
  alpha: number;          // 8-52   整体透明度基数
  lineWidth: number;      // 6-28   线宽基数
  fadeIntensity: number;  // 0-100  减淡层次强度（变化只重算减淡因子）
  centerY: number;        // -50~150 高度位置（百分比，负值=线条整体偏上出画幅，>100=沉到画面以下）
}

export const WIND_DEFAULTS: WindParams = {
  speed: 8, totalLines: 26, parallelCount: 12, spread: 130,
  amplitude: 62, alpha: 28, lineWidth: 13, fadeIntensity: 65, centerY: 46,
};

export const WIND_RECOMMENDED: WindParams = {
  speed: 9, totalLines: 32, parallelCount: 16, spread: 150,
  amplitude: 76, alpha: 34, lineWidth: 17, fadeIntensity: 75, centerY: 46,
};

export interface SkinBackgroundConfig {
  type: BackgroundType;
  contour: ContourParams;
  wind: WindParams;
}

export const DEFAULT_BACKGROUND: SkinBackgroundConfig = {
  type: 'wind',
  contour: { ...CONTOUR_DEFAULTS },
  wind: {
    speed: 4,
    totalLines: 20,
    parallelCount: 9,
    spread: 150,
    amplitude: 75,
    alpha: 30,
    lineWidth: 12,
    fadeIntensity: 100,
    centerY: 94,
  },
};
