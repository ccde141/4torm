/**
 * 皮肤面板 - 徽标 section
 *
 * 提供：开关 + 主标题 / 副标题文字输入。
 * 徽标显示在 Sidebar footer（Orbitron 字体，渐变跟随强调色）。
 */

import React from 'react';
import { patchBadge, DEFAULT_BADGE, type SkinConfig } from '../../store/skin';

interface Props {
  config: SkinConfig;
  onApply: (next: SkinConfig) => void;
}

const BadgeSection: React.FC<Props> = ({ config, onApply }) => {
  const badge = config.badge ?? DEFAULT_BADGE;

  return (
    <>
      <div className="skin-panel__divider" />
      <div className="skin-panel__group">
        <label className="skin-panel__switch-row">
          <span className="skin-panel__label-text">徽标</span>
          <input
            type="checkbox"
            className="skin-panel__switch"
            checked={badge.enabled}
            onChange={e => onApply(patchBadge({ enabled: e.target.checked }))}
          />
        </label>

        {badge.enabled && (
          <div className="skin-panel__badge-fields">
            <input
              type="text"
              className="skin-panel__text-input"
              value={badge.text}
              placeholder="主标题"
              maxLength={24}
              onChange={e => onApply(patchBadge({ text: e.target.value }))}
            />
            <input
              type="text"
              className="skin-panel__text-input"
              value={badge.subtitle}
              placeholder="副标题"
              maxLength={36}
              onChange={e => onApply(patchBadge({ subtitle: e.target.value }))}
            />
          </div>
        )}
      </div>
    </>
  );
};

export default BadgeSection;
