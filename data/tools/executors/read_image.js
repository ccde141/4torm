import { openSync, closeSync, fstatSync, readSync } from 'node:fs'
import { basename } from 'node:path'
import { resolvePath } from './_resolve.js'

const MAX_BYTES = 8 * 1024 * 1024

function imageType(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  throw new Error('图片格式不受支持；支持 PNG、JPEG、GIF 和 WebP')
}

export default async function (args, ctx) {
  const resolved = resolvePath(args.filePath, ctx)
  const fd = openSync(resolved, 'r')
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new Error('filePath 必须指向图片文件')
    if (!stat.size || stat.size > MAX_BYTES) throw new Error('图片必须非空且不超过 8 MiB')
    const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_BYTES + 1))
    let size = 0, read = 0
    do { read = readSync(fd, buffer, size, buffer.length - size, null); size += read }
    while (read && size < buffer.length)
    if (size !== stat.size) throw new Error('图片读取期间发生变化，请重新读取')
    ctx.signal?.throwIfAborted()
    const data = buffer.subarray(0, size)
    return { result: `已读取图片：${basename(resolved)}。图片内容随工具结果提交给支持视觉的模型。`,
      inlineImages: [{ mimeType: imageType(data), data: data.toString('base64') }] }
  } finally { closeSync(fd) }
}
