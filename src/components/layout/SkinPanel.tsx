import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  getSkinConfig,
  loadSkinConfig,
  saveSkinConfig,
  type SkinConfig,
} from '../../store/skin';
import SkinTextureSection from './SkinTextureSection';
import BackgroundSection from './BackgroundSection';
import BadgeSection from './BadgeSection';
import '../../styles/components/skin-panel.css';

interface SkinPanelProps {
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement>;
}

const SkinPanel: React.FC<SkinPanelProps> = ({ onClose, triggerRef }) => {
  const [config, setConfig] = useState<SkinConfig>(getSkinConfig());
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSkinConfig().then(setConfig);
  }, []);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (triggerRef?.current?.contains(e.target as Node)) return;
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose, triggerRef]);

  useEffect(() => {
    const handler = (e: MouseEvent) => handleClickOutside(e);
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [handleClickOutside]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleChange = (patch: Partial<SkinConfig>) => {
    setConfig(saveSkinConfig(patch));
  };

  return (
    <div className="skin-panel" ref={panelRef}>
      <div className="skin-panel__header">
        <span className="skin-panel__title">主题</span>
      </div>
      <div className="skin-panel__body">
        <div className="skin-panel__group">
          <label className="skin-panel__label">
            主色
            <div className="skin-panel__color-row">
              <input
                type="color"
                className="skin-panel__color-input"
                value={config.primaryColor}
                onChange={e => handleChange({ primaryColor: e.target.value })}
              />
              <span className="skin-panel__color-value">{config.primaryColor}</span>
            </div>
          </label>
        </div>
        <div className="skin-panel__group">
          <label className="skin-panel__label">
            氛围光
            <div className="skin-panel__color-row">
              <input
                type="color"
                className="skin-panel__color-input"
                value={config.secondaryColor}
                onChange={e => handleChange({ secondaryColor: e.target.value })}
              />
              <span className="skin-panel__color-value">{config.secondaryColor}</span>
            </div>
          </label>
        </div>

        <SkinTextureSection config={config} onApply={setConfig} />
        <BackgroundSection config={config} onApply={setConfig} />
        <BadgeSection config={config} onApply={setConfig} />
      </div>
    </div>
  );
};

export default SkinPanel;
