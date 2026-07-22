const SILENT_GET_PREFIXES = [
  '/api/storage/read',
  '/api/tradewind/node-status',
  '/api/tide/tasks',
  '/api/convection/list',
  '/api/skills/list',
  '/api/tradewind/status',
  '/api/agents/activity',
];

const SILENT_SUCCESS_REQUESTS = [
  { method: 'POST', prefix: '/api/tradewind/workflow/save' },
];

export function shouldLogRequest(method: string, url: string, statusCode: number): boolean {
  if (statusCode >= 400) return true;
  if (method === 'GET' && /^\/api\/cyclone\/workshop\/[^/]+\/dispatches(?:\?|$)/.test(url)) return false;
  if (method === 'GET' && /^\/api\/cyclone\/workshop\/[^/]+\/seat\/[^/]+\/revision(?:\?|$)/.test(url)) return false;
  if (method === 'GET' && SILENT_GET_PREFIXES.some(prefix => url.startsWith(prefix))) return false;
  return !SILENT_SUCCESS_REQUESTS.some(rule => method === rule.method && url.startsWith(rule.prefix));
}
