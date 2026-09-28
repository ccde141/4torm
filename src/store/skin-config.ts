import type { TextureType, TextureLayer } from '../utils/skin-textures';
import { CONTOUR_DEFAULTS, WIND_DEFAULTS, DEFAULT_BACKGROUND, type BackgroundType, type SkinBackgroundConfig } from './skin-background';
import { DEFAULT_BADGE, type SkinBadgeConfig } from './skin-badge';
import { DEFAULT_VIDEO } from './skin-video-config';
import type { SkinConfig, SkinTextureConfig, TextureBlend, TextureSize } from './skin';

export const DEFAULT_TEXTURE: SkinTextureConfig = {
  layers: ['custom'], opacity: 0.5, blur: 0, blend: 'normal', size: 'cover',
  customImage: '/api/storage/file?path=skin-textures%2Fcustom-1780312588120.png',
  customPath: 'skin-textures/custom-1780312588120.png',
};

export const DEFAULT_SKIN: SkinConfig = {
  primaryColor: '#FFFFFF', secondaryColor: '#A9F8FE',
  texture: DEFAULT_TEXTURE, background: DEFAULT_BACKGROUND, badge: DEFAULT_BADGE,
};

function normalizeTextureLayers(raw: Partial<SkinTextureConfig> | undefined): TextureLayer[] {
  if (!raw) return [...DEFAULT_TEXTURE.layers];
  if (Array.isArray(raw.layers)) return raw.layers.filter((layer): layer is TextureLayer => layer === 'grid' || layer === 'custom' || layer === 'video');
  const legacy = raw as { type?: TextureType; gridOverlay?: boolean };
  const layers: TextureLayer[] = [];
  if (legacy.type === 'grid') layers.push('grid');
  if (legacy.type === 'custom') {
    if (legacy.gridOverlay === true) layers.push('grid');
    layers.push('custom');
  }
  return layers;
}

/** Add missing fields while preserving legacy skin choices. */
export function normalizeSkinConfig(raw: Partial<SkinConfig>): SkinConfig {
  const legacyBackground = raw.background as (Omit<SkinBackgroundConfig, 'type'> & {
    type?: string; video?: SkinTextureConfig['video'];
  }) | undefined;
  const legacyVideo = legacyBackground?.video;
  const video = raw.texture?.video ?? legacyVideo;
  const videoOpacity = video?.opacity;
  const layers = normalizeTextureLayers(raw.texture);
  if (legacyBackground?.type === 'video' && !layers.includes('video')) layers.push('video');
  const texture: SkinTextureConfig = {
    layers,
    opacity: typeof raw.texture?.opacity === 'number' ? raw.texture.opacity : DEFAULT_TEXTURE.opacity,
    blur: typeof raw.texture?.blur === 'number' ? raw.texture.blur : DEFAULT_TEXTURE.blur,
    blend: (raw.texture?.blend as TextureBlend) ?? DEFAULT_TEXTURE.blend,
    size: (raw.texture?.size as TextureSize) ?? 'cover',
    customImage: typeof raw.texture?.customImage === 'string' ? raw.texture.customImage : undefined,
    customPath: typeof raw.texture?.customPath === 'string' ? raw.texture.customPath : undefined,
    video: {
      fit: video?.fit === 'contain' ? 'contain' : 'cover',
      opacity: typeof videoOpacity === 'number' && Number.isFinite(videoOpacity)
        ? Math.max(0, Math.min(1, videoOpacity)) : DEFAULT_VIDEO.opacity,
      id: typeof video?.id === 'string' ? video.id : undefined,
    },
  };
  const background: SkinBackgroundConfig = {
    type: legacyBackground?.type === 'video' ? 'none' : (raw.background?.type as BackgroundType) ?? DEFAULT_BACKGROUND.type,
    contour: { ...CONTOUR_DEFAULTS, ...(raw.background?.contour ?? {}) },
    wind: { ...WIND_DEFAULTS, ...(raw.background?.wind ?? {}) },
  };
  const badge: SkinBadgeConfig = {
    enabled: typeof raw.badge?.enabled === 'boolean' ? raw.badge.enabled : DEFAULT_BADGE.enabled,
    text: typeof raw.badge?.text === 'string' ? raw.badge.text : DEFAULT_BADGE.text,
    subtitle: typeof raw.badge?.subtitle === 'string' ? raw.badge.subtitle : DEFAULT_BADGE.subtitle,
  };
  return { primaryColor: raw.primaryColor || DEFAULT_SKIN.primaryColor,
    secondaryColor: raw.secondaryColor || DEFAULT_SKIN.secondaryColor, texture, background, badge };
}
