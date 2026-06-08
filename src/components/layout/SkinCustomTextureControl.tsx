/**
 * 皮肤面板 - 自定义底纹控制
 *
 * 仅在 texture.type === 'custom' 时显示。
 * 提供：上传 / 重新上传 / 删除 / 平铺方式（cover / contain / repeat）。
 */

import React, { useRef, useState } from 'react';
import {
  uploadCustomTexture,
  clearCustomTexture,
  patchTexture,
  type SkinConfig,
  type SkinTextureConfig,
  type TextureSize,
} from '../../store/skin';
import '../../styles/components/skin-custom.css';

const SIZE_OPTIONS: Array<{ value: TextureSize; label: string }> = [
  { value: 'cover', label: '裁剪铺满' },
  { value: 'contain', label: '完整显示' },
  { value: 'repeat', label: '平铺' },
];

interface Props {
  config: SkinConfig;
  onApply: (next: SkinConfig) => void;
  onError: (msg: string) => void;
}

const SkinCustomTextureControl: React.FC<Props> = ({ config, onApply, onError }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const texture: SkinTextureConfig = config.texture ?? {
    type: 'custom', opacity: 0.4, blur: 0, blend: 'normal',
  };

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      onError('请选择图片文件');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      onError('图片大小不能超过 20MB');
      return;
    }
    setUploading(true);
    try {
      const next = await uploadCustomTexture(file);
      onApply(next);
      onError('');
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    onApply(clearCustomTexture());
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSizeChange = (size: TextureSize) => {
    onApply(patchTexture({ size }));
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  return (
    <div className="skin-panel__custom-control">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={onFileChange}
        className="skin-panel__file-input"
      />

      {texture.customImage ? (
        <div className="skin-panel__preview-row">
          <div
            className="skin-panel__preview"
            style={{ backgroundImage: `url(${texture.customImage})` }}
            title="当前自定义底纹"
          />
          <div className="skin-panel__preview-actions">
            <button
              type="button"
              className="skin-panel__action-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? '上传中…' : '换图'}
            </button>
            <button
              type="button"
              className="skin-panel__action-btn skin-panel__action-btn--danger"
              onClick={handleClear}
              disabled={uploading}
            >
              删除
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="skin-panel__upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '上传中…' : '点击上传图片（≤ 20MB）'}
        </button>
      )}

      {texture.customImage && (
        <label className="skin-panel__select-row">
          <span className="skin-panel__slider-label">平铺方式</span>
          <select
            value={texture.size ?? 'cover'}
            onChange={e => handleSizeChange(e.target.value as TextureSize)}
            className="skin-panel__select"
          >
            {SIZE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
};

export default SkinCustomTextureControl;
