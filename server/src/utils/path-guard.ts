/**
 * 路径安全守卫 — 防止路径穿越
 *
 * 对传入的相对路径做字面检查；不解析符号链接。
 */

import path from 'node:path';

/**
 * 解析相对路径到绝对路径，拒绝指向 dataDir 之外的字面路径。
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
