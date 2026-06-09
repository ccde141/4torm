import { readFileSync, writeFileSync } from 'fs'
import { resolvePath } from './_resolve.js'

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const oldStr = args.oldString || args.old_str || ''
  const newStr = args.newString || args.new_str || ''
  if (!fp || !oldStr) throw new Error('缺少必要参数')
  const resolved = resolvePath(fp, ctx)
  const content = readFileSync(resolved, 'utf-8')
  if (!content.includes(oldStr)) throw new Error(`未找到匹配文本`)
  writeFileSync(resolved, content.replace(oldStr, newStr), 'utf-8')
  return `编辑成功: ${fp}`
}
