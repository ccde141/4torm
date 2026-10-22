import { backendFetch } from '../../lib/backend-client';
interface StoppingRunner {
  userStopped: boolean;
}

async function stopError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `停止执行失败（HTTP ${response.status}）`;
}

/** Keep the SSE authoritative: it closes only after the server runner has actually settled. */
export async function requestConversationStop(
  sessionId: string,
  runId: string,
  runner: StoppingRunner,
  request: typeof fetch = backendFetch,
): Promise<void> {
  runner.userStopped = true;
  try {
    const response = await request('/api/collaboration/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feature: 'monsoon', method: 'stopRun', input: { sessionId, runId },
      }),
    });
    if (!response.ok) throw new Error(await stopError(response));
  } catch (error) {
    runner.userStopped = false;
    throw error;
  }
}
