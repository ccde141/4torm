const MAX_CHARS = 8000
const MAX_BODY_BYTES = 1024 * 1024
const FETCH_TIMEOUT = 15000

export default async function (args, ctx) {
  const url = args.url
  if (!url) throw new Error('缺少 url 参数')

  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctrl.abort() }, FETCH_TIMEOUT)
  const cancel = () => ctrl.abort(ctx.signal.reason)
  ctx.signal?.addEventListener('abort', cancel, { once: true })
  if (ctx.signal?.aborted) cancel()
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 4torm-agent/1.0)' },
    })
    const { text, limited } = await readBody(res, ctrl.signal)
    ctrl.signal.throwIfAborted()
    const statusNote = res.ok ? '' : `(HTTP ${res.status} ${res.statusText})\n`
    const trunc = limited || text.length > MAX_CHARS
      ? `\n\n...[内容过长，仅返回前 ${MAX_CHARS} 字符${limited ? '，响应读取已达上限' : `，共 ${text.length} 字符`}]`
      : ''
    return statusNote + text.slice(0, MAX_CHARS) + trunc
  } catch (e) {
    const detail = timedOut ? `请求超时(${FETCH_TIMEOUT}ms)`
      : ctx.signal?.aborted ? '请求已取消' : e.message
    throw new Error(`抓取失败: ${detail}`)
  } finally {
    clearTimeout(timer)
    ctx.signal?.removeEventListener('abort', cancel)
  }
}

async function readBody(response, signal) {
  if (!response.body) return { text: '', limited: false }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  let limited = false
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      const count = Math.min(value.byteLength, MAX_BODY_BYTES - bytes)
      text += decoder.decode(value.subarray(0, count), { stream: true })
      bytes += count
      if (bytes >= MAX_BODY_BYTES) { limited = true; break }
    }
    text += decoder.decode()
    return { text, limited }
  } finally {
    signal.removeEventListener('abort', cancel)
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
