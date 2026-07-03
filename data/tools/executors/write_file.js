import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import { resolvePath } from './_resolve.js'
import { unifiedDiff } from './_diff.js'

// 覆盖写入时旧内容的最大捕获体积。超过则不回传 before：前端按「全新增」展示，
// 既避免超大 payload 撑爆会话文件，也因为超大文件前端本就会退回省略逐行 diff（存了也白存）。
const MAX_DIFF_BEFORE = 40_000

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const content = args.content || ''
  const resolved = resolvePath(fp, ctx, { write: true })

  // 捕获旧内容作为 UI diff 侧通道：仅随工具事件回给前端，绝不进入 LLM 的结果字符串（不污染 token）
  let before = ''
  try { if (existsSync(resolved)) before = readFileSync(resolved, 'utf-8') } catch { /* 读不到就当新文件 */ }

  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, content, 'utf-8')

  const base = `写入成功: ${fp} (${content.length} 字符)`
  // 原生 diff 内联给 LLM（新建=全新增，覆盖=真实 diff）；meta.diff 供 review_changes 汇总
  const d = unifiedDiff(before, content, fp)
  const result = d.text ? `${base}\n${d.text}` : base
  const diff = { path: fp, kind: 'write', text: d.text, add: d.add, del: d.del }
  // before 侧通道仅覆盖且不超限时回传，供前端 FileDiffCard 渲染（绝不进 LLM 结果串）
  if (before && before.length <= MAX_DIFF_BEFORE) {
    return { result, meta: { before, diff } }
  }
  return { result, meta: { diff } }
}
