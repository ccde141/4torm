import { writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { resolvePath } from './_resolve.js'

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const content = args.content || ''
  const resolved = resolvePath(fp, ctx)
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, content, 'utf-8')
  return `写入成功: ${fp} (${content.length} 字符)`
}
