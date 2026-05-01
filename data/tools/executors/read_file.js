import { readFileSync } from 'fs'
import { resolve } from 'path'

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  if (!fp) throw new Error('缺少 filePath 参数')
  const resolved = resolve(ctx.workspaceDir, fp)
  return readFileSync(resolved, 'utf-8')
}
