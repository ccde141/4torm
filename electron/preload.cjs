/**
 * Electron preload — 通过 contextBridge 暴露受控的桌面能力到 window.desktop。
 *
 * 关键：Electron 32+ 移除了 File.path。获取拖入文件的真实磁盘路径，
 * 必须用 webUtils.getPathForFile(file)，且只能在 preload（主世界之外）调用。
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,

  /**
   * 返回 File 对象对应的绝对磁盘路径（拖入 / 选择的文件）。
   * 浏览器环境下 window.desktop 不存在，调用方需先判断 isElectron。
   * @param {File} file
   * @returns {string} 绝对路径；失败返回空串
   */
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  executionSurface: {
    show(executionId, bounds, leaseId) {
      return ipcRenderer.invoke('execution-surface:show', { executionId, bounds, leaseId });
    },
    hide(executionId, leaseId) {
      return ipcRenderer.invoke('execution-surface:hide', { executionId, leaseId });
    },
    setInputEnabled(executionId, enabled) {
      return ipcRenderer.invoke('execution-surface:set-input-enabled', { executionId, enabled });
    },
  },
});
