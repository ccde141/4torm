import { backendFetch } from '../../lib/backend-client';
const statuses = new Set([
  'queued', 'running', 'waiting', 'completed', 'aborted', 'failed', 'crashed',
]);

export interface RunProbe {
  operationId: string;
  runId: string;
  status: string;
  errorMessage?: string;
}

export async function reconcileMonsoonInterruption(
  sessionId: string,
  runId: string,
  fallback: string,
  request: typeof fetch = backendFetch,
): Promise<string> {
  try {
    const probe = await inspectMonsoonRun(sessionId, runId, request);
    if (!probe) return fallback;
    return explain(probe) ?? fallback;
  } catch { return fallback; }
}

export async function inspectMonsoonRun(
  sessionId: string, runId: string, request: typeof fetch = backendFetch,
): Promise<RunProbe | null> {
  const response = await request('/api/collaboration/invoke', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature: 'monsoon', method: 'getRun', input: { sessionId, runId } }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await response.text());
  return parseProbe(await response.json(), sessionId, runId);
}

export async function inspectCurrentMonsoonRun(
  sessionId: string, request: typeof fetch = backendFetch,
): Promise<RunProbe | null> {
  const response = await request('/api/collaboration/invoke', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feature: 'monsoon', method: 'getCurrentRun', input: { sessionId } }),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await response.text());
  return parseProbe(await response.json(), sessionId);
}

function parseProbe(value: unknown, sessionId: string, runId?: string): RunProbe {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid run probe');
  const probe = value as Record<string, unknown>;
  if (probe.operationId !== sessionId || typeof probe.runId !== 'string'
    || !probe.runId || (runId && probe.runId !== runId)
    || typeof probe.status !== 'string' || !statuses.has(probe.status)) {
    throw new Error('mismatched run probe');
  }
  return {
    operationId: sessionId, runId: probe.runId, status: probe.status,
    ...(typeof probe.errorMessage === 'string' ? { errorMessage: probe.errorMessage } : {}),
  };
}

function explain(probe: RunProbe): string | undefined {
  if (probe.status === 'completed') return '执行已完成，但回复未完整送达';
  if (probe.status === 'aborted') return '执行已中止';
  if (probe.status === 'failed') return probe.errorMessage ? `执行失败：${probe.errorMessage}` : '执行失败';
  if (probe.status === 'crashed') return probe.errorMessage ?? '执行因服务中断而终止';
  if (probe.status === 'waiting') return '执行正在等待人类输入';
  if (probe.status === 'running' || probe.status === 'queued') return '后端仍报告执行中';
  return undefined;
}
