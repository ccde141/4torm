/**
 * 皮肤面板 - 动态背景 section
 *
 * 提供：无 / 等高线 / 风线（disabled）三档切换 + 「配置」按钮。
 * 「配置」按钮打开 BackgroundConfigModal 二级面板。
 */

import React, { useState } from 'react';
import {
  applyBackground,
  type SkinConfig,
  type BackgroundType,
} from '../../store/skin';
import BackgroundConfigModal from './BackgroundConfigModal';

const BG_OPTIONS: Array<{ type: BackgroundType; name: string; desc: string; disabled?: boolean }> = [
  { type: 'none', name: '无', desc: '关闭动态背景' },
  { type: 'contour', name: '等高线', desc: '流动地形等高线' },
  { type: 'wind', name: '风线', desc: '流体风层' },
];

interface Props {
  config: SkinConfig;
  onApply: (next: SkinConfig) => void;
}

const BackgroundSection: React.FC<Props> = ({ config, onApply }) => {
  const [modalOpen, setModalOpen] = useState(false);
  const bgType = config.background?.type ?? 'none';

  const handleTypeChange = (type: BackgroundType) => {
    onApply(applyBackground(type));
  };

  return (
    <>
      <div className="skin-panel__divider" />
      <div className="skin-panel__group">
        <div className="skin-panel__label-text">动态背景</div>
        <div className="skin-panel__texture-row">
          {BG_OPTIONS.map(opt => {
            const active = bgType === opt.type;
            return (
              <button
                key={opt.type}
                type="button"
                className={`skin-panel__texture-btn${active ? ' skin-panel__texture-btn--active' : ''}${opt.disabled ? ' skin-panel__texture-btn--disabled' : ''}`}
                onClick={() => !opt.disabled && handleTypeChange(opt.type)}
                title={opt.desc}
                aria-pressed={active}
                disabled={opt.disabled}
              >
                {opt.name}
              </button>
            );
          })}
        </div>

        {bgType !== 'none' && (
          <button
            type="button"
            className="skin-panel__config-btn"
            onClick={() => setModalOpen(true)}
          >
            ⚙ 配置参数
          </button>
        )}
      </div>

      {modalOpen && (
        <BackgroundConfigModal
          config={config}
          onApply={onApply}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
};

export default BackgroundSection;
