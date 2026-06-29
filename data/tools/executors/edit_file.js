import { readFileSync, writeFileSync } from 'fs'
import { resolvePath } from './_resolve.js'

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const oldStr = args.oldString || args.old_str || ''
  const newStr = args.newString || args.new_str || ''
  const replaceAll = args.replaceAll === true || args.replace_all === true
  if (!fp || !oldStr) throw new Error('缺少必要参数')

  const resolved = resolvePath(fp, ctx)
  const content = readFileSync(resolved, 'utf-8')

  const count = content.split(oldStr).length - 1
  if (count === 0) {
    throw new Error('未找到匹配文本（oldString 必须与文件内容精确匹配，含空格、缩进、换行）')
  }
  if (count > 1 && !replaceAll) {
    throw new Error(`oldString 在文件中出现 ${count} 次，无法确定替换哪一处。请扩大 oldString 包含更多上下文使其唯一，或传 replaceAll=true 全部替换。`)
  }

  // split/join 替换：count===1 时正好替换那一处，replaceAll 时全替；
  // 同时避开 String.replace 把 newString 里的 $&/$1 当特殊模式处理的坑。
  writeFileSync(resolved, content.split(oldStr).join(newStr), 'utf-8')
  return replaceAll && count > 1 ? `编辑成功（替换 ${count} 处）: ${fp}` : `编辑成功: ${fp}`
}
