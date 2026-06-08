/**
 * 皮肤配置 store — 持久化路径：data/skin-config.json
 */

import { buildTextureBackground, getTextureDefaults, type TextureType } from '../utils/skin-textures';
import { hexToRgb, darkenColor, toRgba, readJson, writeJson, uploadBinary, deleteFile, fileUrl } from './skin-helpers';
import {
  CONTOUR_DEFAULTS,
  CONTOUR_RECOMMENDED,
  WIND_DEFAULTS,
  WIND_RECOMMENDED,
  DEFAULT_BACKGROUND,
  type BackgroundType,
  type ContourParams,
  type WindParams,
  type SkinBackgroundConfig,
} from './skin-background';
import { DEFAULT_BADGE, type SkinBadgeConfig } from './skin-badge';

export type { BackgroundType, ContourParams, WindParams, SkinBackgroundConfig, SkinBadgeConfig };
export { CONTOUR_DEFAULTS, CONTOUR_RECOMMENDED, WIND_DEFAULTS, WIND_RECOMMENDED, DEFAULT_BACKGROUND, DEFAULT_BADGE };

export type TextureBlend = 'normal' | 'overlay' | 'soft-light' | 'screen' | 'multiply';
export type TextureSize = 'cover' | 'contain' | 'repeat';

export interface SkinTextureConfig {
  /** 类型（none = 关闭） */
  type: TextureType;
  /** 透明度 0-1 */
  opacity: number;
  /** 模糊（px） */
  blur: number;
  /** 混合模式 */
  blend: TextureBlend;
  /** 图片尺寸模式（仅 type='custom' 使用，缺省 'cover'） */
  size?: TextureSize;
  /**
   * 自定义图片引用（仅 type='custom' 使用）。
   * 新数据：版本化读取 URL（/api/storage/file?...&v=ts）。
   * 旧数据：base64 data URL（兼容保留，仍可直接渲染）。
   */
  customImage?: string;
  /** 自定义图片在 data 目录下的存储路径（清除时据此删文件；旧 base64 数据无此字段） */
  customPath?: string;
}

export interface SkinConfig {
  /** 主色（强调色）— 控制 --color-accent 系列 */
  primaryColor: string;
  /** 氛围光 — 控制 --ambient-glow 系列 */
  secondaryColor: string;
  /** 底纹（可选，缺省 = none） */
  texture?: SkinTextureConfig;
  /** 动态背景（可选，缺省 = none） */
  background?: SkinBackgroundConfig;
  /** 徽标（可选，缺省 = 关闭） */
  badge?: SkinBadgeConfig;
}

const DEFAULT_TEXTURE: SkinTextureConfig = {
  type: 'custom',
  opacity: 0.5,
  blur: 0,
  blend: 'normal',
  size: 'cover',
  customImage: '/api/storage/file?path=skin-textures%2Fcustom-1780312588120.png',
  customPath: 'skin-textures/custom-1780312588120.png',
};

const DEFAULTS: SkinConfig = {
  primaryColor: '#FFFFFF',
  secondaryColor: '#A9F8FE',
  texture: DEFAULT_TEXTURE,
  background: DEFAULT_BACKGROUND,
  badge: DEFAULT_BADGE,
};

let cached: SkinConfig = { ...DEFAULTS };

// ── 订阅机制：让 App 等组件监听皮肤变更 ────────
type Listener = (config: SkinConfig) => void;
const listeners = new Set<Listener>();

export function subscribeSkin(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l(cached);
}

function applyConfig(config: SkinConfig): void {
  const root = document.documentElement;
  const primary = config.primaryColor || DEFAULTS.primaryColor;
  root.style.setProperty('--color-accent', primary);
  root.style.setProperty('--color-accent-hover', darkenColor(primary, 35));
  root.style.setProperty('--color-accent-subtle', toRgba(primary, 0.12));
  root.style.setProperty('--color-accent-glow', toRgba(primary, 0.25));

  const secondary = config.secondaryColor || DEFAULTS.secondaryColor;
  const rgb = hexToRgb(secondary);
  if (rgb) {
    root.style.setProperty('--ambient-glow-1', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
  } else {
    root.style.setProperty('--ambient-glow-1', 'rgba(59, 130, 246, 0.35)');
  }

  applyTextureVars(config, root);
}

function applyTextureVars(config: SkinConfig, root: HTMLElement): void {
  const texture = config.texture ?? DEFAULT_TEXTURE;
  const bg = buildTextureBackground(texture.type, texture.customImage);
  root.style.setProperty('--texture', bg);
  root.style.setProperty('--texture-opacity', String(texture.opacity));
  root.style.setProperty('--texture-blur', `${texture.blur}px`);
  root.style.setProperty('--texture-blend', texture.blend);

  // 图片纹理需要单独控制 size / repeat；SVG 纹理永远 repeat
  const isImage = texture.type === 'custom';
  const sizeMode = texture.size ?? 'cover';
  if (isImage && sizeMode !== 'repeat') {
    root.style.setProperty('--texture-size', sizeMode);
    root.style.setProperty('--texture-repeat', 'no-repeat');
  } else {
    root.style.setProperty('--texture-size', 'auto');
    root.style.setProperty('--texture-repeat', 'repeat');
  }
}

/** 兼容旧数据：补全 texture / background 字段 */
function normalize(raw: Partial<SkinConfig>): SkinConfig {
  const primaryColor = raw.primaryColor || DEFAULTS.primaryColor;
  const secondaryColor = raw.secondaryColor || DEFAULTS.secondaryColor;
  const texture: SkinTextureConfig = {
    type: (raw.texture?.type as TextureType) ?? DEFAULT_TEXTURE.type,
    opacity: typeof raw.texture?.opacity === 'number' ? raw.texture.opacity : DEFAULT_TEXTURE.opacity,
    blur: typeof raw.texture?.blur === 'number' ? raw.texture.blur : DEFAULT_TEXTURE.blur,
    blend: (raw.texture?.blend as TextureBlend) ?? DEFAULT_TEXTURE.blend,
    size: (raw.texture?.size as TextureSize) ?? 'cover',
    customImage: typeof raw.texture?.customImage === 'string' ? raw.texture.customImage : undefined,
    customPath: typeof raw.texture?.customPath === 'string' ? raw.texture.customPath : undefined,
  };
  const background: SkinBackgroundConfig = {
    type: (raw.background?.type as BackgroundType) ?? DEFAULT_BACKGROUND.type,
    contour: { ...CONTOUR_DEFAULTS, ...(raw.background?.contour ?? {}) },
    wind: { ...WIND_DEFAULTS, ...(raw.background?.wind ?? {}) },
  };
  const badge: SkinBadgeConfig = {
    enabled: typeof raw.badge?.enabled === 'boolean' ? raw.badge.enabled : DEFAULT_BADGE.enabled,
    text: typeof raw.badge?.text === 'string' ? raw.badge.text : DEFAULT_BADGE.text,
    subtitle: typeof raw.badge?.subtitle === 'string' ? raw.badge.subtitle : DEFAULT_BADGE.subtitle,
  };
  return { primaryColor, secondaryColor, texture, background, badge };
}

export async function loadSkinConfig(): Promise<SkinConfig> {
  const data = await readJson<Partial<SkinConfig>>('skin-config.json');
  const config = data ? normalize(data) : { ...DEFAULTS };
  cached = config;
  applyConfig(config);
  // 通知所有订阅者（Sidebar 等独立组件）：初始加载完成。
  // 否则它们仍持有挂载时的 DEFAULTS（如 badge.enabled=false），
  // 直到用户手动改动触发 saveSkinConfig 才会更新 —— 表现为「刷新后徽标消失」。
  notify();
  return config;
}

/** 防抖写文件：连续 patch 时只在最后一次 250ms 后落盘 */
let writeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    // 后台写，失败仅 console，不阻塞用户操作
    writeJson('skin-config.json', cached).catch(err => {
      console.error('[skin] 持久化失败:', err);
    });
  }, 250);
}

/**
 * 立即应用 + 异步落盘（防抖 250ms）。
 *
 * 同步路径：更新 cached → 应用 CSS 变量 → 立刻 return。
 * 这样 React 控件不会等 HTTP 往返，滑杆 / 颜色 picker 不卡顿。
 */
export function saveSkinConfig(patch: Partial<SkinConfig>): SkinConfig {
  const next = { ...cached, ...patch };
  cached = next;
  applyConfig(next);
  scheduleWrite();
  notify();
  return next;
}

/** 切换底纹类型（套用该类型的建议默认参数） */
export function applyTexture(type: TextureType): SkinConfig {
  const defaults = getTextureDefaults(type);
  const current = cached.texture;
  // 切到 custom 但没有图片：依然切，UI 会显示上传按钮；CSS 写 none
  const texture: SkinTextureConfig = {
    type,
    opacity: defaults.opacity,
    blur: defaults.blur,
    blend: defaults.blend as TextureBlend,
    customImage: current?.customImage,
    size: current?.size ?? 'cover',
  };
  return saveSkinConfig({ texture });
}

/** 上传自定义图片（File → data URL → 持久化 + 自动切到 custom 类型） */
const TEXTURE_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  'image/avif': 'avif',
};

export async function uploadCustomTexture(file: File): Promise<SkinConfig> {
  const ext = TEXTURE_EXT[file.type] ?? 'png';
  const version = Date.now();
  const storePath = `skin-textures/custom-${version}.${ext}`;

  // 先删旧文件（避免不同扩展名残留孤儿）
  const prev = cached.texture;
  if (prev?.customPath) await deleteFile(prev.customPath);

  await uploadBinary(storePath, file);

  const defaults = getTextureDefaults('custom');
  const texture: SkinTextureConfig = {
    type: 'custom',
    opacity: prev?.type === 'custom' && typeof prev.opacity === 'number'
      ? prev.opacity
      : defaults.opacity,
    blur: prev?.blur ?? defaults.blur,
    blend: (prev?.blend ?? defaults.blend) as TextureBlend,
    size: prev?.size ?? 'cover',
    customImage: fileUrl(storePath, version),
    customPath: storePath,
  };
  return saveSkinConfig({ texture });
}

/** 清除自定义图片 + 退回 none（同时删除存储文件） */
export function clearCustomTexture(): SkinConfig {
  const current = cached.texture ?? DEFAULT_TEXTURE;
  if (current.customPath) void deleteFile(current.customPath);
  return saveSkinConfig({
    texture: { ...current, type: 'none', customImage: undefined, customPath: undefined },
  });
}

/** 微调底纹参数（保持类型不变） */
export function patchTexture(patch: Partial<SkinTextureConfig>): SkinConfig {
  const current = cached.texture ?? DEFAULT_TEXTURE;
  return saveSkinConfig({ texture: { ...current, ...patch } });
}

/** 切换动态背景类型 */
export function applyBackground(type: BackgroundType): SkinConfig {
  const current = cached.background ?? DEFAULT_BACKGROUND;
  return saveSkinConfig({ background: { ...current, type } });
}

/** 微调等高线参数（保持类型不变） */
export function patchContour(patch: Partial<ContourParams>): SkinConfig {
  const current = cached.background ?? DEFAULT_BACKGROUND;
  return saveSkinConfig({
    background: { ...current, contour: { ...current.contour, ...patch } },
  });
}

/** 微调风线参数（保持类型不变） */
export function patchWind(patch: Partial<WindParams>): SkinConfig {
  const current = cached.background ?? DEFAULT_BACKGROUND;
  return saveSkinConfig({
    background: { ...current, wind: { ...current.wind, ...patch } },
  });
}

/** 微调徽标配置 */
export function patchBadge(patch: Partial<SkinBadgeConfig>): SkinConfig {
  const current = cached.badge ?? DEFAULT_BADGE;
  return saveSkinConfig({ badge: { ...current, ...patch } });
}

export function getSkinConfig(): SkinConfig {
  return { ...cached };
}
