/**
 * 皮肤面板 - 底纹 section
 *
 * 拆分自 SkinPanel，避免主面板超 300 行。
 * 提供：底纹类型按钮 + 透明度 / 模糊 / 混合模式微调。
 * 自定义图片上传逻辑独立在 SkinCustomTextureControl。
 */

import React, { useState } from 'react';
import {
  toggleTextureLayer,
  patchTexture,
  type SkinConfig,
  type SkinTextureConfig,
  type TextureBlend,
  type TextureLayer,
} from '../../store/skin';
import SkinCustomTextureControl from './SkinCustomTextureControl';
import '../../styles/components/skin-texture.css';

// 平级、可共存的底纹图层（多选）
const TEXTURE_LAYERS: Array<{ layer: TextureLayer; name: string; desc: string }> = [
  { layer: 'grid', name: '网格', desc: '细线栅格' },
  { layer: 'custom', name: '自定义', desc: '上传图片作为底纹' },
];

const BLEND_OPTIONS: Array<{ value: TextureBlend; label: string }> = [
  { value: 'normal', label: '正常' },
  { value: 'screen', label: '滤色' },
  { value: 'overlay', label: '叠加' },
  { value: 'soft-light', label: '柔光' },
  { value: 'multiply', label: '正片叠底' },
];

interface Props {
  config: SkinConfig;
  onApply: (next: SkinConfig) => void;
}

const SkinTextureSection: React.FC<Props> = ({ config, onApply }) => {
  const [error, setError] = useState<string | null>(null);
  const texture: SkinTextureConfig = config.texture ?? {
    layers: [], opacity: 0, blur: 0, blend: 'normal',
  };
  const layers = texture.layers ?? [];
  const isCustom = layers.includes('custom');
  const showDetails = layers.length > 0;

  const handleToggle = (layer: TextureLayer) => {
    setError(null);
    onApply(toggleTextureLayer(layer));
  };

  const handlePatch = (patch: Partial<SkinTextureConfig>) => {
    onApply(patchTexture(patch));
  };

  return (
    <>
      <div className="skin-panel__divider" />
      <div className="skin-panel__group">
        <div className="skin-panel__label-text">底纹</div>
        <div className="skin-panel__texture-row">
          {TEXTURE_LAYERS.map(opt => {
            const active = layers.includes(opt.layer);
            return (
              <button
                key={opt.layer}
                type="button"
                className={`skin-panel__texture-btn${active ? ' skin-panel__texture-btn--active' : ''}`}
                onClick={() => handleToggle(opt.layer)}
                title={opt.desc}
                aria-pressed={active}
              >
                {active ? '✓ ' : ''}{opt.name}
              </button>
            );
          })}
        </div>
        <div className="skin-panel__hint-text">可多选叠加 · 网格恒显示在自定义图之上</div>

        {error && <div className="skin-panel__error">{error}</div>}

        {isCustom && (
          <SkinCustomTextureControl
            config={config}
            onApply={onApply}
            onError={setError}
          />
        )}

        {/* 透明度 / 模糊 / 混合模式 — 作用于全部启用图层 */}
        {showDetails && (
          <TextureControls texture={texture} onPatch={handlePatch} />
        )}
      </div>
    </>
  );
};

interface ControlsProps {
  texture: SkinTextureConfig;
  onPatch: (patch: Partial<SkinTextureConfig>) => void;
}

const TextureControls: React.FC<ControlsProps> = ({ texture, onPatch }) => {
  return (
    <div className="skin-panel__texture-controls">
      <label className="skin-panel__slider-row">
        <span className="skin-panel__slider-label">
          透明度
          <span className="skin-panel__slider-value">{Math.round(texture.opacity * 100)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(texture.opacity * 100)}
          onChange={e => onPatch({ opacity: Number(e.target.value) / 100 })}
          className="skin-panel__slider"
        />
      </label>

      <label className="skin-panel__slider-row">
        <span className="skin-panel__slider-label">
          模糊
          <span className="skin-panel__slider-value">{texture.blur}px</span>
        </span>
        <input
          type="range"
          min={0}
          max={20}
          step={1}
          value={texture.blur}
          onChange={e => onPatch({ blur: Number(e.target.value) })}
          className="skin-panel__slider"
        />
      </label>

      <label className="skin-panel__select-row">
        <span className="skin-panel__slider-label">混合模式</span>
        <select
          value={texture.blend}
          onChange={e => onPatch({ blend: e.target.value as TextureBlend })}
          className="skin-panel__select"
        >
          {BLEND_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
};

export default SkinTextureSection;


