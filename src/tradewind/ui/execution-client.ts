export async function requestStop(fallback = '停止工作流失败'): Promise<void> {
  const response = await fetch('/api/tradewind/stop', { method: 'POST' });
  if (response.ok || response.status === 404) return;
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  const message = typeof body?.error === 'string' && body.error.trim()
    ? body.error
    : `${fallback} (HTTP ${response.status})`;
  throw new Error(message);
}
