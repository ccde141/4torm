/** The page and every feature island share this transport boundary. */
export interface BackendConnection {
  origin?: string;
}

declare global {
  interface Window {
    __FOURTORM_CONNECTION__?: BackendConnection;
  }
}

export function resolveBackendOrigin(configuredOrigin?: string): string {
  if (!configuredOrigin?.trim()) return '';
  const url = new URL(configuredOrigin.trim());
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('后端地址必须使用 HTTPS，本机回环地址除外');
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('后端地址必须是完整 origin，不能包含路径或凭据');
  }
  return url.origin;
}

/** Runtime configuration is read for each request; no feature caches its own host. */
export function backendOrigin(): string {
  const runtime = typeof window === 'undefined' ? undefined : window.__FOURTORM_CONNECTION__?.origin;
  const configured = runtime ?? import.meta.env?.VITE_BACKEND_ORIGIN
    ?? (import.meta.env?.DEV ? import.meta.env?.VITE_STREAM_ORIGIN : undefined);
  return resolveBackendOrigin(configured);
}

/** Images, downloads and streams use the same address as ordinary API requests. */
export function backendUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${backendOrigin()}${path}`;
}

function requestUrl(input: RequestInfo | URL): string {
  const path = input instanceof Request ? input.url : String(input);
  const resolved = backendUrl(path);
  const relative = resolved.startsWith('/') && !resolved.startsWith('//');
  // Validate after URL normalization too: browsers treat /\\host and embedded
  // whitespace as authority separators, even when the raw string starts with /.
  const origin = backendOrigin() || (typeof location === 'undefined' ? '' : location.origin);
  const base = origin || 'https://backend.invalid';
  const url = new URL(resolved, base);
  if ((!origin && !relative) || url.origin !== base || url.username || url.password) {
    throw new Error('后端请求不能发送到其他服务或携带地址凭据');
  }
  return relative ? resolved : url.href;
}

/** Never retries: a lost response must not silently replay model calls or mutations. */
export async function backendFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  const request = input instanceof Request ? new Request(url, input) : url;
  const response = await fetch(request, { ...init, credentials: 'include', redirect: 'error' });
  reportBackendStatus(response.status, response.headers.get('x-4torm-auth-required') === '1');
  return response;
}

/** Binary uploads have an XHR progress port, but share authentication expiry. */
export function reportBackendStatus(status: number, authenticationRequired = false): void {
  if (status === 401 && authenticationRequired && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('4torm:authentication-required'));
  }
}

export function createBackendEventSource(path: string): EventSource {
  return new EventSource(requestUrl(path), { withCredentials: true });
}
