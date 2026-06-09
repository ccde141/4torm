import { readdirSync } from 'fs'
import { resolvePath } from './_resolve.js'

export default async function (args, ctx) {
  const dirPath = args.dirPath || args.dir_path || '.'
  const resolved = resolvePath(dirPath, ctx)
  const entries = readdirSync(resolved, { withFileTypes: true })
  return entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n') || '(空目录)'
}
