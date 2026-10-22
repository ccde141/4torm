import { backendFetch } from '../lib/backend-client';

/** Provider errors and connection failures remain distinct; no model call is replayed. */
export async function modelRuntimeRequest<T>(
  path: string, method = 'GET', body?: unknown, signal?: AbortSignal,
): Promise<T> {
  const response = await backendFetch(`/api/model-runtime${path}`, {
    method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(70_000)]) : AbortSignal.timeout(70_000),
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = value && typeof value.error === 'string' ? value.error : `HTTP ${response.status}`;
    throw new Error(`模型服务：${detail}`);
  }
  if (value === null) throw new Error('模型服务返回了无效响应');
  return value as T;
}
