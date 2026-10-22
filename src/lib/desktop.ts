/**
 * 桌面（Electron）能力桥接层。
 *
 * window.desktop 由 electron/preload.cjs 注入；浏览器环境下为 undefined。
 * 所有调用方应通过本模块访问，便于浏览器/桌面双形态共存与单测桩替换。
 */

import { backendOrigin } from './backend-client';

export interface DesktopBridge {
  isElectron: true;
  /** Remote clients upload file bytes; their disk paths are not server paths. */
  backendMode?: 'local' | 'remote';
  /** File → 绝对磁盘路径（仅 Electron）。失败返回空串。 */
  getPathForFile(file: File): string;
  executionSurface?: {
    show(executionId: string, bounds: { x: number; y: number; width: number; height: number }, leaseId?: string): Promise<void>;
    hide(executionId: string, leaseId?: string): Promise<void>;
    setInputEnabled(executionId: string, enabled: boolean): Promise<void>;
  };
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
export function filePath(file: File, desktop = bridge): string {
  if (desktop?.backendMode === 'remote' || usesRemoteBackend()) return '';
  return desktop?.getPathForFile(file) ?? '';
}

/** A remote Electron shell has no native surface owned by the remote backend. */
export function getDesktopExecutionSurface(desktop = bridge): DesktopBridge['executionSurface'] {
  return desktop?.backendMode === 'remote' || usesRemoteBackend() ? undefined : desktop?.executionSurface;
}

function usesRemoteBackend(): boolean {
  const origin = backendOrigin();
  return Boolean(origin && typeof window !== 'undefined' && origin !== window.location?.origin);
}
