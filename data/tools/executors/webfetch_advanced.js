export default async function (args, ctx) {
  const { url, selector, timeout = 15000 } = args;
  if (!url) throw new Error('缺少 url 参数');

  let chromium;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    try {
      const res = await fetch(url);
      const html = await res.text();
      const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, '\n')
        .trim();
      const trunc = text.length > 8000 ? `\n\n...[内容过长，仅返回前 8000 字符，共 ${text.length} 字符]` : '';
      return `[Playwright 未安装，仅返回静态 HTML 文本。如需完整动态渲染内容，请运行 npm install 安装 Playwright]\n\n${text.slice(0, 8000)}${trunc}`;
    } catch (e) {
      throw new Error(`抓取失败: ${(e).message}`);
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 10000) }).catch(() => {});

    await new Promise(r => setTimeout(r, 1500));

    let text;
    if (selector) {
      const el = await page.$(selector);
      text = el ? (await el.textContent() || '') : `(未找到选择器: ${selector})`;
    } else {
      text = await page.evaluate(() => {
        document.querySelectorAll('script, style, noscript, iframe').forEach(el => el.remove());
        return document.body?.innerText || document.title || '';
      });
    }

    const title = await page.title();
    const header = title && !text.startsWith(title) ? `## ${title}\n\n` : '';
    const full = header + text.trim();
    const body = full.slice(0, 16000);
    const trunc = full.length > 16000 ? `\n\n...[内容过长，仅返回前 16000 字符，共 ${full.length} 字符]` : '';
    return (body + trunc) || '(页面无可见文本内容)';
  } finally {
    await browser.close().catch(() => {});
  }
}
