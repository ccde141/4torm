/**
 * 动态背景二级配置面板（内联版）
 *
 * 紧贴「配置参数」按钮下方展开，不再使用全屏遮罩弹窗。
 * 等高线模式：6 个滑杆；风线模式：9 个滑杆。
 */

import React from 'react';
import {
  patchContour,
  patchWind,
  CONTOUR_DEFAULTS,
  CONTOUR_RECOMMENDED,
  WIND_DEFAULTS,
  WIND_RECOMMENDED,
  type SkinConfig,
  type ContourParams,
  type WindParams,
} from '../../store/skin';
import '../../styles/components/bg-config-modal.css';

interface Props {
  config: SkinConfig;
  onApply: (next: SkinConfig) => void;
  onClose: () => void;
}

const CONTOUR_DEFS: Array<{
  key: keyof ContourParams;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'speed', label: '流速', min: 1, max: 60, step: 1 },
  { key: 'peaks', label: '峰数', min: 2, max: 25, step: 1 },
  { key: 'interval', label: '等高距', min: 2, max: 35, step: 1 },
  { key: 'alpha', label: '透明度', min: 5, max: 80, step: 1 },
  { key: 'rough', label: '粗糙度', min: 1, max: 25, step: 1 },
  { key: 'lwidth', label: '线宽', min: 2, max: 35, step: 1 },
];

const WIND_DEFS: Array<{
  key: keyof WindParams;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'speed', label: '流速', min: 1, max: 38, step: 1 },
  { key: 'totalLines', label: '线条数', min: 4, max: 52, step: 1 },
  { key: 'parallelCount', label: '平行数', min: 0, max: 36, step: 1 },
  { key: 'centerY', label: '高度位置', min: -50, max: 150, step: 1 },
  { key: 'spread', label: '覆盖幅度', min: 30, max: 340, step: 1 },
  { key: 'amplitude', label: '弯曲度', min: 15, max: 180, step: 1 },
  { key: 'fadeIntensity', label: '减淡层次', min: 0, max: 100, step: 1 },
  { key: 'alpha', label: '透明度', min: 8, max: 52, step: 1 },
  { key: 'lineWidth', label: '线宽', min: 6, max: 28, step: 1 },
];

const BackgroundConfigModal: React.FC<Props> = ({ config, onApply, onClose }) => {
  const bgType = config.background?.type ?? 'contour';
  const isWind = bgType === 'wind';

  const params: Record<string, number> = isWind
    ? (config.background?.wind ?? WIND_DEFAULTS) as unknown as Record<string, number>
    : (config.background?.contour ?? CONTOUR_DEFAULTS) as unknown as Record<string, number>;
  const defs = isWind ? WIND_DEFS : CONTOUR_DEFS;
  const title = isWind ? '⚙ 风线' : '⚙ 等高线';

  const handleSlider = (key: string, value: number) => {
    onApply(isWind ? patchWind({ [key]: value }) : patchContour({ [key]: value }));
  };

  const handleRecommend = () => {
    onApply(isWind ? patchWind(WIND_RECOMMENDED) : patchContour(CONTOUR_RECOMMENDED));
  };

  const handleReset = () => {
    onApply(isWind ? patchWind(WIND_DEFAULTS) : patchContour(CONTOUR_DEFAULTS));
  };

  return (
    <div className="bg-config-inline">
      <div className="bg-config-inline__header">
        <span className="bg-config-inline__title">{title}</span>
        <button
          className="bg-config-inline__close"
          onClick={onClose}
          aria-label="关闭"
        >×</button>
      </div>

      <div className="bg-config-inline__body">
        {defs.map(def => (
          <label key={def.key} className="bg-config-inline__row">
            <span className="bg-config-inline__label">
              {def.label}
              <span className="bg-config-inline__value">{params[def.key]}</span>
            </span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={params[def.key]}
              onChange={e => handleSlider(def.key, Number(e.target.value))}
              className="bg-config-inline__slider"
            />
          </label>
        ))}
      </div>

      <div className="bg-config-inline__footer">
        <button
          className="bg-config-inline__btn bg-config-inline__btn--primary"
          onClick={handleRecommend}
        >推荐值</button>
        <button
          className="bg-config-inline__btn"
          onClick={handleReset}
        >重置默认</button>
      </div>
    </div>
  );
};

export default BackgroundConfigModal;
