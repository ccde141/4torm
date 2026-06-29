import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { resolvePath } from './_resolve.js'

const MAX_ENTRIES = 300  // 条数上限：超大目录不一次性灌爆上下文

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${(bytes / 1024 / 1024).toFixed(1)}M`
}

export default async function (args, ctx) {
  const dirPath = args.dirPath || args.dir_path || '.'
  const resolved = resolvePath(dirPath, ctx)
  const entries = readdirSync(resolved, { withFileTypes: true })
  if (entries.length === 0) return '(空目录)'

  // 目录在前、文件在后，各自按名排序，便于浏览
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort()
  const files = entries.filter(e => !e.isDirectory()).map(e => e.name).sort()
  const ordered = [
    ...dirs.map(n => ({ name: n, dir: true })),
    ...files.map(n => ({ name: n, dir: false })),
  ]
  const total = ordered.length

  const lines = ordered.slice(0, MAX_ENTRIES).map(({ name, dir }) => {
    if (dir) return `📁 ${name}/`
    let size = ''
    try { size = ` (${humanSize(statSync(join(resolved, name)).size)})` } catch { /* ignore */ }
    return `📄 ${name}${size}`
  })

  const footer = total > MAX_ENTRIES
    ? `\n...（共 ${total} 项，仅显示前 ${MAX_ENTRIES} 项）`
    : ''
  return lines.join('\n') + footer
}
