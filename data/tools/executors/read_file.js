import { readFileSync } from 'fs'
import { resolvePath } from './_resolve.js'

export default async function (args, ctx) {
  const fp = args.filePath || args.file_path
  const resolved = resolvePath(fp, ctx)
  return readFileSync(resolved, 'utf-8')
}
