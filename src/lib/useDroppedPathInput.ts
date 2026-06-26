/**
 * 桌面拖拽 → 把文件真实路径追加进某个对话输入框。
 *
 * 监听 DesktopDropLayer 广播的 `desktop:files-dropped` 事件，将路径文本
 * 追加到给定输入框的 state，并复用「高度自适应 + 聚焦」逻辑。
 *
 * 用 `enabled` 守卫调用方的可见性 / 归属：页面常驻（display:none 切换）时，
 * 多个对话框会同时挂载，必须只让当前可见的「主对话框」接收，且绕开会长栏
 * （会长无工具能力，路径无意义）。
 */

import { useEffect, type Dispatch, type SetStateAction, type RefObject } from 'react';
import {
  DESKTOP_FILES_DROPPED,
  type DesktopFilesDroppedEvent,
} from '../components/desktop/DesktopDropLayer';

export function useDroppedPathInput(
  setInput: Dispatch<SetStateAction<string>>,
  inputRef: RefObject<HTMLTextAreaElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onDropped = (e: Event) => {
      const { files } = (e as DesktopFilesDroppedEvent).detail;
      const text = files
        .map(f => f.path)
        .filter(Boolean)
        .map(p => (/\s/.test(p) ? `"${p}"` : p)) // 含空格的路径加引号
        .join(' ');
      if (!text) return;
      setInput(prev => (prev && !/\s$/.test(prev) ? prev + ' ' : prev) + text);
      // setInput 不触发 onChange，手动复算 textarea 高度并聚焦
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 200) + 'px';
        el.focus();
      });
    };
    window.addEventListener(DESKTOP_FILES_DROPPED, onDropped);
    return () => window.removeEventListener(DESKTOP_FILES_DROPPED, onDropped);
  }, [enabled, setInput, inputRef]);
}
