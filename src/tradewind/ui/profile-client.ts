export interface AutoProfile {
  id: string;
  name: string;
  cadence: { kind: 'relative'; gapSec: number };
  overlap: 'skip' | 'queue';
  lapBound: number | null;
  carryOver: 'accumulate' | 'reset' | 'summary';
  loopNote?: string;
  summaryPrompt?: string;
}

async function requireOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  const message = typeof body?.error === 'string' && body.error.trim()
    ? body.error
    : `${fallback}（HTTP ${response.status}）`;
  throw new Error(message);
}

export async function listProfiles(workflowId: string): Promise<AutoProfile[]> {
  const response = await fetch(`/api/tradewind/workflow/${encodeURIComponent(workflowId)}/profiles`);
  await requireOk(response, '加载循环档案失败');
  const body = await response.json() as { profiles?: AutoProfile[] };
  return Array.isArray(body.profiles) ? body.profiles : [];
}

export async function saveProfiles(workflowId: string, profiles: AutoProfile[]): Promise<void> {
  const response = await fetch(`/api/tradewind/workflow/${encodeURIComponent(workflowId)}/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles }),
  });
  await requireOk(response, '保存循环档案失败');
}

export async function deleteProfile(workflowId: string, profileId: string): Promise<void> {
  const response = await fetch(
    `/api/tradewind/workflow/${encodeURIComponent(workflowId)}/profiles/${encodeURIComponent(profileId)}`,
    { method: 'DELETE' },
  );
  await requireOk(response, '删除循环档案失败');
}
