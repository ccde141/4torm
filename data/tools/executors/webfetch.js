const MAX_CHARS = 8000
const FETCH_TIMEOUT = 15000

export default async function (args, ctx) {
  const url = args.url
  if (!url) throw new Error('缺少 url 参数')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT)
  let res
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 4torm-agent/1.0)' },
    })
  } catch (e) {
    throw new Error(`抓取失败: ${e.name === 'AbortError' ? `请求超时(${FETCH_TIMEOUT}ms)` : e.message}`)
  } finally {
    clearTimeout(timer)
  }

  const text = await res.text()
  const statusNote = res.ok ? '' : `(HTTP ${res.status} ${res.statusText})\n`
  const body = text.slice(0, MAX_CHARS)
  const trunc = text.length > MAX_CHARS
    ? `\n\n...[内容过长，仅返回前 ${MAX_CHARS} 字符，共 ${text.length} 字符]`
    : ''
  return statusNote + body + trunc
}
