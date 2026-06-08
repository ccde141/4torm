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
const TEXT_EXTS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.json', '.css', '.html', '.md', '.txt',
  '.py', '.yaml', '.yml', '.toml', '.xml', '.svg', '.sh', '.bat', '.ps1',
  '.env', '.gitignore', '.cfg', '.ini', '.conf',
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

  const lines = results.slice(0, MAX_RESULTS).map(r =>
    `${r.file}:${r.line}: ${r.text.trim()}`
  )
  const truncated = results.length > MAX_RESULTS
    ? `\n...（共 ${results.length} 条，仅显示前 ${MAX_RESULTS} 条）`
    : ''

  return lines.join('\n') + truncated
}

function safeRegex(pattern) {
  try { return new RegExp(pattern, 'gi') }
  catch { return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') }
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
      const ext = '.' + name.split('.').pop()?.toLowerCase()
      if (!TEXT_EXTS.has(ext)) continue

      let content
      try { content = readFileSync(full, 'utf-8') } catch { continue }

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
