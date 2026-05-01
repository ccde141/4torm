export default async function (args, ctx) {
  const url = args.url
  if (!url) throw new Error('缺少 url 参数')
  const res = await fetch(url)
  const text = await res.text()
  return text.slice(0, 8000)
}
