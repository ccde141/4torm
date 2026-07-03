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

// 框架控制面文件/目录（相对 dataDir）：即便 unrestricted 也禁止 agent 直接写，
// 否则可绕过 create_automation / create_workflow 的专用工具与人工确认，伪造任务/工作流/注册表。
const CONTROL_PLANE_FILES = ['tide/tasks.json', 'agents/registry.json', 'tools/registry.json']
const CONTROL_PLANE_DIRS = ['tradewind/workflows']

/** target 是否等于 base 或落在 base 目录内（用 path.relative 归一化分隔符/盘符/大小写，跨平台稳） */
function within(target, base) {
  const rel = path.relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 写操作前校验：命中控制面则拒绝。读操作不受限。 */
function assertWritable(resolved, ctx) {
  if (!ctx.dataDir) return
  const files = CONTROL_PLANE_FILES.map(p => path.resolve(ctx.dataDir, p))
  const dirs = CONTROL_PLANE_DIRS.map(p => path.resolve(ctx.dataDir, p))
  const hit = files.some(f => path.relative(f, resolved) === '') || dirs.some(d => within(resolved, d))
  if (hit) {
    throw new Error(`拒绝写入框架控制文件：${resolved}。潮汐任务/工作流/注册表须经专用工具 + 人工确认，不能直接改写。`)
  }
}

/**
 * @param {string} fp 用户传入的文件路径（相对或绝对）
 * @param {{ dataDir?: string, workspaceDir: string, projectDir: string, sandboxLevel?: 'strict' | 'relaxed' | 'unrestricted' }} ctx
 * @param {{ write?: boolean }} [opts] write=true 时额外做控制面保护（write_file/edit_file/delete_file 传入）
 * @returns {string} 校验通过后的绝对路径
 */
export function resolvePath(fp, ctx, opts = {}) {
  if (!fp) throw new Error('缺少 filePath 参数')
  const level = ctx.sandboxLevel || 'relaxed'

  // 无限制：不做沙箱越权校验（接受相对路径，相对于 workspaceDir）；但控制面写保护仍生效
  if (level === 'unrestricted') {
    const resolved = path.isAbsolute(fp) ? fp : path.resolve(ctx.workspaceDir, fp)
    if (opts.write) assertWritable(resolved, ctx)
    return resolved
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

  if (opts.write) assertWritable(resolved, ctx)
  return resolved
}
