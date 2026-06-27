/**
 * 桌面全局拖拽层（仅 Electron 生效，浏览器下完全惰性）。
 *
 * 捕获拖入应用窗口的文件，解析真实磁盘路径，再以 CustomEvent
 * `desktop:files-dropped` 广播出去 —— 任意功能（皮肤底纹、聊天附件等）
 * 监听该事件即可消费，无需各自实现拖拽与路径解析。
 *
 * 用法（消费方）：
 *   window.addEventListener('desktop:files-dropped', e => {
 *     const { files } = (e as DesktopFilesDroppedEvent).detail;
 *   });
 */

import { useEffect, useState } from 'react';
import { isElectron, filePath } from '../../lib/desktop';

export interface DroppedFile {
  name: string;
  /** 绝对磁盘路径（Electron）；解析失败为空串 */
  path: string;
  type: string;
  size: number;
}

export type DesktopFilesDroppedEvent = CustomEvent<{ files: DroppedFile[] }>;

export const DESKTOP_FILES_DROPPED = 'desktop:files-dropped';

export function DesktopDropLayer() {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!isElectron) return;

    let depth = 0; // dragenter/leave 会冒泡，用计数避免子元素切换时闪烁

    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      depth += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault(); // 必须，否则 drop 不触发
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);

      const files: DroppedFile[] = Array.from(e.dataTransfer.files).map((f) => ({
        name: f.name,
        path: filePath(f),
        type: f.type,
        size: f.size,
      }));

      window.dispatchEvent(
        new CustomEvent(DESKTOP_FILES_DROPPED, { detail: { files } }),
      );
      // 开发期可见反馈，便于确认能力打通
      console.info('[desktop] files dropped:', files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!isElectron || !dragging) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          padding: 'var(--space-6) var(--space-10)',
          borderRadius: 'var(--border-radius-lg)',
          border: '2px dashed var(--color-accent)',
          background: 'var(--glass-bg)',
          color: 'var(--color-text-primary)',
          font: '600 var(--text-lg)/1.4 var(--font-sans)',
          boxShadow: 'var(--glass-shadow)',
        }}
      >
        松开以拖入文件
      </div>
    </div>
  );
}
