import { readdirSync } from 'fs'
import { resolve } from 'path'

export default async function (args, ctx) {
  const dirPath = args.dirPath || args.dir_path || '.'
  const resolved = resolve(ctx.workspaceDir, dirPath)
  const entries = readdirSync(resolved, { withFileTypes: true })
  return entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n') || '(空目录)'
}
