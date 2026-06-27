/**
 * 桌面（Electron）能力桥接层。
 *
 * window.desktop 由 electron/preload.cjs 注入；浏览器环境下为 undefined。
 * 所有调用方应通过本模块访问，便于浏览器/桌面双形态共存与单测桩替换。
 */

export interface DesktopBridge {
  isElectron: true;
  /** File → 绝对磁盘路径（仅 Electron）。失败返回空串。 */
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

const bridge: DesktopBridge | undefined =
  typeof window !== 'undefined' ? window.desktop : undefined;

/** 当前是否运行在 Electron 桌面壳内 */
export const isElectron = Boolean(bridge?.isElectron);

/**
 * 取拖入 / 选择文件的真实磁盘绝对路径。
 * 浏览器环境（无桥接）返回空串 —— 调用方据此回退到 base64/FileReader 流程。
 */
export function filePath(file: File): string {
  return bridge?.getPathForFile(file) ?? '';
}
