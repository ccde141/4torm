import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const content = args.content || ''
  if (!fp) throw new Error('缺少 filePath 参数')
  const resolved = resolve(ctx.workspaceDir, fp)
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, content, 'utf-8')
  return `写入成功: ${fp} (${content.length} 字符)`
}
