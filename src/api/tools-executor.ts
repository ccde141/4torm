const BASE = '/api/tools/exec';

export async function executeTool(tool: string, args: Record<string, string>, agentId?: string): Promise<string> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, args, agentId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `请求失败: ${res.status}` }));
    throw new Error(err.error || `工具执行失败`);
  }
  const data = await res.json();
  return data.result || data.error || '';
}

export const DANGEROUS_TOOLS = ['write_file', 'edit_file', 'run_command'];
