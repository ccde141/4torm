const BASE = '/api/tools/permissions';

export async function getPermissions(agentId: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${BASE}?agentId=${encodeURIComponent(agentId)}`);
    return res.json();
  } catch {
    return {};
  }
}

export async function savePermissions(agentId: string, permissions: Record<string, string>): Promise<void> {
  await fetch(`${BASE}?agentId=${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(permissions),
  });
}

export type PermLevel = 'always' | 'ask' | 'never';
