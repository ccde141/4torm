/**
 * 文件工具共享路径解析 + 控制面写保护
 *
 * 两档文件访问语义：
 *   - 相对路径统一基于 ctx.workspaceDir
 *   - project 仅允许项目目录和当前工作区
 *   - unrestricted 允许其他绝对路径
 *
 * 使用方式：
 *   import { resolvePath } from './_resolve.js'
 *   const resolved = resolvePath(args.filePath, ctx)
 */
import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import path from 'node:path'

// 框架控制面文件/目录（相对 dataDir）：即便 unrestricted 也禁止 agent 直接写，
// 否则可绕过 create_automation / create_workflow 的专用工具与人工确认，伪造任务/工作流/注册表。
const CONTROL_PLANE_FILES = ['tide/tasks.json', 'agents/registry.json', 'tools/registry.json']
// 工作流目录：保护每个工作流的控制文件（graph.json / meta.json 等），
// 但**放行** {wfId}/workspace/ —— 那是 agent 的工作区，本就该自由读写（信封产物、交付物等）。
const WORKFLOWS_ROOT = 'tradewind/workflows'

/** target 是否等于 base 或落在 base 目录内（用 path.relative 归一化分隔符/盘符/大小写，跨平台稳） */
function within(target, base) {
  const rel = path.relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function canonicalPath(target, depth = 0) {
  if (depth > 20) throw new Error(`符号链接层级过深：${target}`)
  const absolute = path.resolve(target)
  const root = path.parse(absolute).root
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean)
  let cursor = root
  for (const part of parts) {
    const candidate = path.join(cursor, part)
    let stat
    try {
      stat = lstatSync(candidate)
    } catch {
      cursor = candidate
      continue
    }
    if (!stat.isSymbolicLink()) {
      cursor = candidate
      continue
    }
    try {
      cursor = realpathSync.native(candidate)
    } catch {
      const link = readlinkSync(candidate)
      cursor = canonicalPath(path.resolve(path.dirname(candidate), link), depth + 1)
    }
  }
  return path.resolve(cursor)
}

function normalizeLevel(level) {
  return level === 'unrestricted' ? 'unrestricted' : 'project'
}

function assertInAllowedRoot(resolved, ctx) {
  if (normalizeLevel(ctx.sandboxLevel) === 'unrestricted') return
  const target = canonicalPath(resolved)
  const roots = [ctx.projectDir, ctx.workspaceDir].filter(Boolean).map(canonicalPath)
  if (!roots.some(root => within(target, root))) {
    throw new Error(`项目级权限仅允许访问当前工作区或项目目录：${resolved}`)
  }
}

/** 写操作前校验：命中控制面则拒绝。读操作不受限。 */
function assertWritable(resolved, ctx) {
  if (!ctx.dataDir) return
  const target = canonicalPath(resolved)
  const files = CONTROL_PLANE_FILES.map(p => canonicalPath(path.resolve(ctx.dataDir, p)))
  const fileHit = files.some(f => path.relative(f, target) === '')

  // 工作流目录：命中则拒，但 {wfId}/workspace/** 是 agent 工作区，放行。
  let workflowHit = false
  const wfRoot = canonicalPath(path.resolve(ctx.dataDir, WORKFLOWS_ROOT))
  if (within(target, wfRoot)) {
    const parts = path.relative(wfRoot, target).split(path.sep) // [wfId, seg2, ...]
    const inWorkspace = parts.length >= 2 && parts[1] === 'workspace'
    workflowHit = !inWorkspace
  }

  if (fileHit || workflowHit) {
    throw new Error(`拒绝写入框架控制文件：${resolved}。潮汐任务/工作流/注册表须经专用工具 + 人工确认，不能直接改写。`)
  }
}

/**
 * @param {string} fp 用户传入的文件路径（相对或绝对）
 * @param {{ dataDir?: string, workspaceDir: string, projectDir: string, sandboxLevel?: 'project' | 'unrestricted' | 'strict' | 'relaxed' }} ctx
 * @param {{ write?: boolean }} [opts] write=true 时额外做控制面保护（write_file/edit_file/delete_file 传入）
 * @returns {string} 校验通过后的绝对路径
 */
export function resolvePath(fp, ctx, opts = {}) {
  if (!fp) throw new Error('缺少 filePath 参数')
  const resolved = path.isAbsolute(fp) ? path.resolve(fp) : path.resolve(ctx.workspaceDir, fp)

  assertInAllowedRoot(resolved, ctx)
  if (opts.write) assertWritable(resolved, ctx)
  return resolved
}
