import { readFileSync } from 'fs'
import { resolvePath } from './_resolve.js'

// 不指定 limit 时的默认行数上限：覆盖绝大多数正常源码文件（一次读完、不打扰），
// 又能拦住几千行的大文件。想更激进地引导分段阅读，调小即可（如 250/500）。
const DEFAULT_LIMIT = 800
// 单行字符上限：真正的防溢出——压缩 JS/CSS、整块 JSON、base64、日志常「一行几 MB」，
// 纯按行数封顶拦不住，这里对超长行做截断。
const MAX_LINE_CHARS = 2000

function clampLine(line) {
  if (line.length <= MAX_LINE_CHARS) return line
  return line.slice(0, MAX_LINE_CHARS) + ` … [本行另有 ${line.length - MAX_LINE_CHARS} 字符未显示]`
}

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const resolved = resolvePath(fp, ctx)
  const content = readFileSync(resolved, 'utf-8')

  const lines = content.split('\n')
  const total = lines.length

  // offset：起始行（1-based，默认第 1 行）；limit：读取行数（默认 DEFAULT_LIMIT）
  const offset = Math.max(1, parseInt(args.offset, 10) || 1)
  const limit = args.limit != null && args.limit !== ''
    ? Math.max(1, parseInt(args.limit, 10))
    : DEFAULT_LIMIT
  const start = offset - 1
  const end = Math.min(start + limit, total)

  const sliced = lines.slice(start, end)
  const hasLongLine = sliced.some(l => l.length > MAX_LINE_CHARS)
  const body = sliced.map(clampLine).join('\n')

  // 从头读、整文件都在范围内、且没有超长行 → 原样返回全文（与旧行为完全兼容）
  if (start === 0 && end >= total && !hasLongLine) return content

  const header = `[文件共 ${total} 行，本次显示第 ${offset}–${end} 行]`
  const footer = end < total
    ? `\n\n[还有 ${total - end} 行未显示，需要的话用 offset=${end + 1} 继续读取（可配合 limit 控制每次行数）]`
    : ''
  return `${header}\n${body}${footer}`
}
