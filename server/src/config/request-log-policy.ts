import type { ModuleMethodKind } from '../engine/collaboration/contracts.js';

const SILENT_SUCCESS_POSTS = new Set([
  '/api/tradewind/workflow/save',
  '/api/collaboration/observe',
  '/api/collaboration/snapshot',
  '/api/collaboration/operation',
  '/api/collaboration/operation/wait',
  '/api/collaboration/records/find',
  '/api/collaboration/records/read',
  '/api/collaboration/records/agents/latest',
]);

/** 查询参数可能含本地路径或凭据；终端只显示请求路径。 */
export function requestLogPath(url: string): string {
  return url.split('?')[0]!.replace(/[\u0000-\u001f\u007f]/g, '');
}

export function shouldLogRequest(
  method: string, url: string, statusCode: number,
  callKind?: ModuleMethodKind, detailed = false,
): boolean {
  if (statusCode >= 400) return true;
  if (detailed) return true;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  if (method !== 'POST') return true;
  const pathname = requestLogPath(url);
  if (SILENT_SUCCESS_POSTS.has(pathname)) return false;
  // POST 并不一定是写操作；以中心注册协议为准，不猜测方法名称。
  return pathname !== '/api/collaboration/invoke' || callKind !== 'query';
}
