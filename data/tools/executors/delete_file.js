/**
 * delete_file — 删除文件或目录
 *
 * 沙箱校验：复用 _resolve.js，不允许越权删除。
 * 目录删除：默认递归（force），谨慎使用。
 */

import { rmSync, statSync } from 'node:fs'
import { resolvePath } from './_resolve.js'

/**
 * @param {{ filePath?: string, dirPath?: string, recursive?: boolean }} args
 * @param {{ workspaceDir: string, projectDir: string, sandboxLevel?: string }} ctx
 */
export default async function (args, ctx) {
  const target = args.filePath || args.dirPath
  if (!target) throw new Error('缺少 filePath 或 dirPath 参数')

  const resolved = resolvePath(target, ctx)
  const isDir = statSync(resolved, { throwIfNoEntry: false })?.isDirectory()
  const recursive = args.recursive !== false

  rmSync(resolved, { recursive: isDir ? recursive : false, force: true })

  return isDir
    ? `已删除目录: ${target}`
    : `已删除文件: ${target}`
}
