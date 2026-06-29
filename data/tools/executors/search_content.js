/**
 * search_content — 在目录中递归搜索文本内容
 *
 * 类似 grep -r，返回匹配行及所在文件/行号。
 * 沙箱校验：搜索范围受 _resolve.js 约束。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { resolvePath } from './_resolve.js'

const MAX_FILE_BYTES = 500 * 1024  // 单文件上限 500KB
const MAX_RESULTS = 200             // 全局命中上限
const MAX_LINE_CHARS = 500          // 单条匹配行字符上限（防压缩文件超长行灌爆输出）
// 已知二进制扩展名直接跳过；其余文件再按 NUL 字节探测，从而支持任意文本语言（go/rust/vue/...）
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  '.mp3', '.mp4', '.wav', '.mov', '.webm', '.avi', '.flac', '.ogg',
  '.zip', '.gz', '.tar', '.rar', '.7z', '.bz2', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.class', '.o', '.a',
  '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.db', '.sqlite', '.sqlite3',
])

/**
 * @param {{ dirPath?: string, pattern: string, filePattern?: string }} args
 * @param {{ workspaceDir: string, projectDir: string, sandboxLevel?: string }} ctx
 */
export default async function (args, ctx) {
  if (!args.pattern) throw new Error('缺少 pattern 参数')

  const startDir = resolvePath(args.dirPath || '.', ctx)
  const regex = safeRegex(args.pattern)
  const fileFilter = args.filePattern ? new RegExp(args.filePattern) : null
  const results = []

  searchDir(startDir, startDir, regex, fileFilter, results)
  if (results.length === 0) return `未找到匹配 "${args.pattern}" 的内容`

  const lines = results.slice(0, MAX_RESULTS).map(r => {
    let t = r.text.trim()
    if (t.length > MAX_LINE_CHARS) t = t.slice(0, MAX_LINE_CHARS) + ' …[行过长已截断]'
    return `${r.file}:${r.line}: ${t}`
  })
  const truncated = results.length > MAX_RESULTS
    ? `\n...（共 ${results.length} 条，仅显示前 ${MAX_RESULTS} 条）`
    : ''

  return lines.join('\n') + truncated
}

function safeRegex(pattern) {
  // 不能带 g 标志：下面用 .test() 逐行判断，g 会让 lastIndex 有状态、跨行漏匹配
  try { return new RegExp(pattern, 'i') }
  catch { return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
}

function isBinary(content) {
  // 取前 8KB 探 NUL 字节（grep 同款判定），含 NUL 视为二进制
  const n = Math.min(content.length, 8192)
  for (let i = 0; i < n; i++) if (content.charCodeAt(i) === 0) return true
  return false
}

function searchDir(root, dir, regex, fileFilter, results) {
  if (results.length >= MAX_RESULTS) return

  let entries
  try { entries = readdirSync(dir) }
  catch { return }

  for (const name of entries) {
    if (name.startsWith('.') || name === 'node_modules') continue

    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }

    if (st.isDirectory()) {
      searchDir(root, full, regex, fileFilter, results)
    } else if (st.isFile() && st.size <= MAX_FILE_BYTES) {
      if (fileFilter && !fileFilter.test(name)) continue
      const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : ''
      if (BINARY_EXTS.has(ext)) continue

      let content
      try { content = readFileSync(full, 'utf-8') } catch { continue }
      if (isBinary(content)) continue

      const lines = content.split('\n')
      for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
        if (regex.test(lines[i])) {
          results.push({
            file: relative(root, full).replace(/\\/g, '/'),
            line: i + 1,
            text: lines[i],
          })
        }
      }
    }
  }
}
