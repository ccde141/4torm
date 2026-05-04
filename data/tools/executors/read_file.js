import { readFileSync } from 'fs'
import { resolve } from 'path'

function resolvePath(fp, workspaceDir, projectDir) {
  if (!fp) throw new Error('缺少 filePath 参数')
  if (fp.replace(/\\/g, '/').startsWith('data/')) {
    return resolve(projectDir, fp)
  }
  return resolve(workspaceDir, fp)
}

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const resolved = resolvePath(fp, ctx.workspaceDir, ctx.projectDir)
  return readFileSync(resolved, 'utf-8')
}
