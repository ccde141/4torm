/**
 * 文件工具共享路径解析 + 沙箱校验
 *
 * 三档沙箱级别（来自 agent 配置）：
 *   - 'strict'        只能在 ctx.workspaceDir 内读写
 *   - 'relaxed'（默认）可在 ctx.workspaceDir 或 ctx.projectDir 内读写
 *   - 'unrestricted'  可在文件系统任意位置读写
 *
 * 三档都阻止 ".." 越权到允许根目录之外（unrestricted 除外）。
 *
 * 使用方式：
 *   import { resolvePath } from './_resolve.js'
 *   const resolved = resolvePath(args.filePath, ctx)
 */
import path from 'node:path'

/**
 * @param {string} fp 用户传入的文件路径（相对或绝对）
 * @param {{ workspaceDir: string, projectDir: string, sandboxLevel?: 'strict' | 'relaxed' | 'unrestricted' }} ctx
 * @returns {string} 校验通过后的绝对路径
 */
export function resolvePath(fp, ctx) {
  if (!fp) throw new Error('缺少 filePath 参数')
  const level = ctx.sandboxLevel || 'relaxed'

  // 无限制：直接 resolve，不做任何校验（接受相对路径，相对于 workspaceDir）
  if (level === 'unrestricted') {
    return path.isAbsolute(fp) ? fp : path.resolve(ctx.workspaceDir, fp)
  }

  // 决定基准目录：以 data/ 开头的路径用 projectDir 解析（兼容 relaxed 历史行为）
  const normalized = fp.replace(/\\/g, '/')
  const base = (level === 'relaxed' && normalized.startsWith('data/'))
    ? ctx.projectDir
    : ctx.workspaceDir

  const resolved = path.resolve(base, fp)

  // 允许根目录列表
  const allowedRoots = level === 'strict'
    ? [path.resolve(ctx.workspaceDir)]
    : [path.resolve(ctx.workspaceDir), path.resolve(ctx.projectDir)]

  // 阻止 .. 越权
  const ok = allowedRoots.some(root =>
    resolved === root || resolved.startsWith(root + path.sep)
  )
  if (!ok) {
    throw new Error(
      `路径越权 (沙箱=${level})：${fp} 解析到 ${resolved}，超出允许范围 [${allowedRoots.join(', ')}]`
    )
  }

  return resolved
}
