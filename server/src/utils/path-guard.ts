/**
 * 路径安全守卫 — 防止路径穿越
 *
 * 所有文件操作必须经过此函数校验，确保路径在 DATA_DIR 内。
 */

import path from 'node:path';

/**
 * 解析相对路径到绝对路径，确保在 dataDir 内。
 * 非法路径抛出错误。
 */
export function resolveSafePath(dataDir: string, filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('路径不能为空');
  }

  // 禁止绝对路径
  if (path.isAbsolute(filePath)) {
    throw new Error(`非法绝对路径：${filePath}`);
  }

  // 规范化并解析
  const resolved = path.resolve(dataDir, filePath);

  // 确保在 dataDir 内（防 ../ 穿越）
  const normalizedBase = path.resolve(dataDir) + path.sep;
  if (!resolved.startsWith(normalizedBase) && resolved !== path.resolve(dataDir)) {
    throw new Error(`路径越界：${filePath}`);
  }

  return resolved;
}
