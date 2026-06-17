/**
 * SSE 长流专用 API base。
 *
 * 背景：HTTP/1.1 同 origin 仅 6 条并发连接。Vite dev 下浏览器连 5173，
 * 所有 SSE 长流（信风会话、委派、压缩…）都挂在这 6 条里，开几条流就把
 * 普通请求（轮询/读写）挤到排队，单请求被拖到数百毫秒。
 *
 * 解法：dev 下让长流直连 Fastify(3001)，绕开 Vite proxy。于是流独占 3001
 * 的 6 条连接配额，普通请求独占 5173 的 6 条，互不挤占。
 *
 * prod 下返回空串（同源相对路径），并发上限后续靠 HTTP/2 解决。
 *
 * 用 location.hostname 动态拼接：从别的设备连 dev server 时，流也指向那台
 * 机的 3001，而非访问者自己的 localhost。
 */
export const STREAM_BASE = import.meta.env.DEV
  ? `${location.protocol}//${location.hostname}:3001`
  : '';

/** 给长流路径加上 base 前缀（普通短请求无需调用，维持走 Vite proxy）。 */
export function streamUrl(path: string): string {
  return `${STREAM_BASE}${path}`;
}
