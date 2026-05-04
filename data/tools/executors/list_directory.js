import { readdirSync } from 'fs'
import { resolve } from 'path'

function resolvePath(fp, workspaceDir, projectDir) {
  if (fp.replace(/\\/g, '/').startsWith('data/')) {
    return resolve(projectDir, fp)
  }
  return resolve(workspaceDir, fp)
}

export default async function (args, ctx) {
  const dirPath = args.dirPath || args.dir_path || '.'
  const resolved = resolvePath(dirPath, ctx.workspaceDir, ctx.projectDir)
  const entries = readdirSync(resolved, { withFileTypes: true })
  return entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`).join('\n') || '(空目录)'
}
