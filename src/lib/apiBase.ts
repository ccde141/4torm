/**
 * SSE 长流专用 API base。
 *
 * 开发态默认同源，经 Vite 代理到 Fastify。浏览器不需要直接信任本地自签证书。
 * 配置可信的 VITE_STREAM_ORIGIN 后可直连后端 HTTP/2。
 * 生产态同源，由 Fastify 直接提供 HTTPS/2。
 */
export function resolveStreamBase(dev: boolean, configuredOrigin?: string): string {
  if (!dev || !configuredOrigin?.trim()) return '';
  const url = new URL(configuredOrigin.trim());
  if (url.protocol !== 'https:') throw new Error('VITE_STREAM_ORIGIN 必须使用 HTTPS');
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('VITE_STREAM_ORIGIN 必须是 HTTPS origin');
  }
  return url.origin;
}

export const STREAM_BASE = resolveStreamBase(
  import.meta.env?.DEV ?? false,
  import.meta.env?.VITE_STREAM_ORIGIN,
);

/** 给长流路径加上 base 前缀（普通短请求无需调用，维持走 Vite proxy）。 */
export function streamUrl(path: string): string {
  return `${STREAM_BASE}${path}`;
}
