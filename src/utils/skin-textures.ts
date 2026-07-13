/**
 * 皮肤底纹 SVG 生成器
 *
 * 输出 base64 data URL，用于 CSS background-image。
 * 颜色注入：runtime 接受 hex 主色，生成对应配色的 SVG。
 *
 * 设计要点：
 * - 网格：1px 等距线网，对齐 32px 栅格
 * - 自定义：用户上传的图片 data URL，由调用方传入
 *
 * 性能：所有 SVG 都是单次生成内联到 CSS 变量，无 DOM 节点。
 */

export type TextureType = 'none' | 'grid' | 'custom';
/** 可独立开关、可共存的底纹图层种类（多选模型） */
export type TextureLayer = 'grid' | 'custom';

/** 把 SVG 字符串转成 data URL（不用 btoa，直接 URL 编码兼容中文） */
function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `url("data:image/svg+xml;charset=utf-8,${encoded}")`;
}

/**
 * 网格描边色 — 固定中性浅灰，刻意不绑定氛围光 / 强调色。
 * 网格是「结构线」，与「光」解耦：别处调暗不会导致网格消失。
 */
const GRID_STROKE = '#9CA3AF';

/** 网格：32px 栅格细线 */
function gridSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="${GRID_STROKE}" stroke-width="0.5" opacity="0.6"/></svg>`;
}

/** 把任意 data URL（含 image/png 等）包装成 CSS url() */
function rawDataUrl(dataUrl: string): string {
  return `url("${dataUrl}")`;
}

/** 网格图层的 background-image 值（供「自定义图 + 网格」叠加时单独取用） */
export function gridBackgroundUrl(): string {
  return svgToDataUrl(gridSvg());
}

/**
 * 生成纹理 background-image 值
 *
 * @param type 纹理类型
 * @param customImage 自定义图片 data URL（type='custom' 时必传）
 */
export function buildTextureBackground(
  type: TextureType,
  customImage?: string,
): string {
  if (type === 'grid') return svgToDataUrl(gridSvg());
  if (type === 'custom' && customImage) return rawDataUrl(customImage);
  return 'none';
}

/** 不同纹理类型对应的默认参数（建议值） */
export interface TextureDefaults {
  opacity: number;
  blur: number;
  blend: string;
}

export function getTextureDefaults(type: TextureType): TextureDefaults {
  switch (type) {
    case 'grid':
      return { opacity: 0.18, blur: 0, blend: 'normal' };
    case 'custom':
      return { opacity: 0.4, blur: 0, blend: 'normal' };
    default:
      return { opacity: 0, blur: 0, blend: 'normal' };
  }
}
