import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { SkinConfig } from '../../store/skin';
import { DEFAULT_VIDEO, type VideoBackgroundParams } from '../../store/skin-video-config';
import { replaceBackgroundVideo, removeBackgroundVideo, patchBackgroundVideo } from '../../store/skin-video-actions';
import { backgroundVideoUrl } from '../../store/skin-video';

interface Props { config: SkinConfig; onApply: (next: SkinConfig) => void }

function VideoSettings({ video, onPatch }: { video: VideoBackgroundParams; onPatch: (patch: Partial<VideoBackgroundParams>) => void }) {
  return <>
    <label className="skin-panel__select-row"><span className="skin-panel__slider-label">显示方式</span>
      <select className="skin-panel__select" value={video.fit} onChange={event => onPatch({ fit: event.target.value as 'cover' | 'contain' })}>
        <option value="cover">铺满并裁切</option><option value="contain">完整显示</option>
      </select>
    </label>
    <label className="skin-panel__slider-row"><span className="skin-panel__slider-label">视频强度</span>
      <input className="skin-panel__slider" type="range" min="0.1" max="1" step="0.05" value={video.opacity}
        onChange={event => onPatch({ opacity: Number(event.target.value) })} />
    </label>
  </>;
}

function useVideoTransfer(onApply: Props['onApply']) {
  const uploadRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => () => uploadRef.current?.abort(), []);

  async function run(action: () => Promise<string | void>): Promise<void> {
    setBusy(true); setError('');
    try {
      const warning = await action();
      if (warning) setError(warning);
    } catch (cause) {
      if (!(cause instanceof Error && cause.message === '视频上传已取消')) {
        setError(cause instanceof Error ? cause.message : '视频处理失败');
      }
    } finally { setBusy(false); }
  }

  async function upload(file: File): Promise<void> {
    if (uploadRef.current) return;
    const controller = new AbortController();
    uploadRef.current = controller;
    setUploadProgress({ loaded: 0, total: file.size });
    try {
      await run(() => replaceBackgroundVideo(file, onApply, {
        signal: controller.signal,
        onProgress: loaded => setUploadProgress({ loaded, total: file.size }),
      }));
    } finally {
      uploadRef.current = null;
      setUploadProgress(null);
    }
  }

  return { busy, uploadProgress, error, setError, run, upload, cancel: () => uploadRef.current?.abort() };
}

export default function BackgroundVideoControl({ config, onApply }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { busy, uploadProgress, error, setError, run, upload, cancel } = useVideoTransfer(onApply);
  const video = config.texture?.video ?? DEFAULT_VIDEO;
  const url = backgroundVideoUrl(video.id);

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault(); setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) void upload(file);
  }

  return <div className="skin-video-control">
    <input ref={inputRef} type="file" accept=".mp4,.webm,video/mp4,video/webm" hidden
      onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
    <div className={`skin-video-control__drop${dragging ? ' skin-video-control__drop--active' : ''}`}
      onDragOver={event => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      拖入视频，或点击下方选择 · MP4/WebM · 大文件可逐步上传
    </div>
    {uploadProgress && <div className="skin-video-control__progress" role="status">
      <span>{uploadProgress.loaded >= uploadProgress.total ? '正在保存视频…' : `正在上传 · ${Math.floor(uploadProgress.loaded / uploadProgress.total * 100)}%`}</span>
      <progress value={uploadProgress.loaded} max={uploadProgress.total} aria-label="视频上传进度" />
    </div>}
    {url && <video className="skin-video-control__preview" src={url} controls muted playsInline preload="metadata"
      aria-label="当前视频背景预览" onError={() => setError('视频无法读取或解码，请尝试 H.264 MP4 或 WebM')} />}
    <div className="skin-video-control__row">
      <button className="skin-panel__config-btn" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? '处理中…' : url ? '更换视频' : '选择视频'}
      </button>
      {uploadProgress && <button className="skin-panel__config-btn" type="button" onClick={cancel}>取消上传</button>}
      {url && <button className="skin-panel__config-btn" type="button" disabled={busy} onClick={() => void run(() => removeBackgroundVideo(onApply))}>移除</button>}
    </div>
    {url && <VideoSettings video={video} onPatch={patch => patchBackgroundVideo(patch, onApply)} />}
    {error && <div className="skin-panel__error" role="alert">{error}</div>}
  </div>;
}
