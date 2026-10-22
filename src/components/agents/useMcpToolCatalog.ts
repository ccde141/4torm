import { useEffect, useState } from 'react';
import { backendFetch } from '../../lib/backend-client';
import type { McpToolItem } from './AgentToolCapabilities';

export async function readMcpToolGroups(request: typeof fetch = backendFetch, signal?: AbortSignal): Promise<Record<string, McpToolItem[]>> {
  const response = await request('/api/mcp/tools', { signal });
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
  const result: unknown = await response.json();
  const groups = result && typeof result === 'object' && !Array.isArray(result)
    ? (result as { groups?: unknown }).groups : undefined;
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) throw new Error('MCP 工具列表格式无效');
  for (const tools of Object.values(groups)) {
    if (!Array.isArray(tools) || tools.some(tool => !tool || typeof tool !== 'object'
      || typeof tool.name !== 'string' || typeof tool.fullName !== 'string'
      || typeof tool.description !== 'string')) throw new Error('MCP 工具定义格式无效');
  }
  return groups as Record<string, McpToolItem[]>;
}

export function useMcpToolCatalog(active: boolean) {
  const [groups, setGroups] = useState<Record<string, McpToolItem[]>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let current: AbortController | undefined;
    const reload = () => {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      setLoading(true);
      readMcpToolGroups(backendFetch, controller.signal).then(next => {
        if (live && !controller.signal.aborted) { setGroups(next); setError(''); }
      }).catch(reason => {
        if (live && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      }).finally(() => {
        if (live && !controller.signal.aborted) setLoading(false);
      });
    };
    const visible = () => { if (!document.hidden) reload(); };
    reload();
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', visible);
    return () => { live = false; current?.abort(); window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', visible); };
  }, [active, revision]);
  return { groups, error, loading, refresh: () => refresh(value => value + 1) };
}
