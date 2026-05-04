import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

function resolvePath(fp, workspaceDir, projectDir) {
  if (!fp) throw new Error('缺少 filePath 参数')
  if (fp.replace(/\\/g, '/').startsWith('data/')) {
    return resolve(projectDir, fp)
  }
  return resolve(workspaceDir, fp)
}

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const content = args.content || ''
  const resolved = resolvePath(fp, ctx.workspaceDir, ctx.projectDir)
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, content, 'utf-8')
  return `写入成功: ${fp} (${content.length} 字符)`
}
