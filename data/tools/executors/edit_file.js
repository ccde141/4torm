import { readFileSync, writeFileSync } from 'fs'
import { resolvePath } from './_resolve.js'
import { unifiedDiff } from './_diff.js'

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const oldStr = args.oldString || args.old_str || ''
  const newStr = args.newString || args.new_str || ''
  const replaceAll = args.replaceAll === true || args.replace_all === true
  if (!fp || !oldStr) throw new Error('缺少必要参数')

  const resolved = resolvePath(fp, ctx, { write: true })
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
  const after = content.split(oldStr).join(newStr)
  writeFileSync(resolved, after, 'utf-8')

  const base = replaceAll && count > 1 ? `编辑成功（替换 ${count} 处）: ${fp}` : `编辑成功: ${fp}`
  // 原生 diff 内联给 LLM：改完即结构化看清改了什么；meta.diff 供 review_changes 汇总
  const d = unifiedDiff(content, after, fp)
  const result = d.text ? `${base}\n${d.text}` : base
  return { result, meta: { diff: { path: fp, kind: 'edit', text: d.text, add: d.add, del: d.del } } }
}
