/**
 * 统一工具执行路由
 *
 * 判断工具来源：
 * - mcp:* → 走 MCP client 调用
 * - 其他 → 走 tool-bridge HTTP 代理
 *
 * 各引擎（信风/对流/季风）统一调用此函数。
 */

import { callMcpTool } from './mcp-manager';

const TOOL_BRIDGE_URL = (process.env.TOOL_BRIDGE_URL || 'http://localhost:3001').replace(/\/+$/, '');

export interface ExecToolOpts {
  tool: string;
  args: Record<string, string>;
  agentId: string;
  workspaceDir?: string;
  sandboxLevel?: string;
  signal?: AbortSignal;
  /** UI 侧通道：接收执行器回传的展示元数据（如覆盖写入旧内容），不影响 LLM 结果字符串 */
  onMeta?: (meta: unknown) => void;
}

export async function execToolUnified(opts: ExecToolOpts): Promise<string> {
  const { tool, args, agentId, workspaceDir, sandboxLevel, signal, onMeta } = opts;

  // MCP 工具：直接走 MCP client
  if (tool.startsWith('mcp:')) {
    return callMcpTool(tool, args);
  }

  // 本地工具：走 tool-bridge HTTP
  const url = `${TOOL_BRIDGE_URL}/api/tools/exec`;
  const body: Record<string, any> = { tool, args, agentId };
  if (workspaceDir) body.workspaceDirOverride = workspaceDir;
  if (sandboxLevel) body.sandboxLevelOverride = sandboxLevel;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`tool-bridge error (${res.status}): ${text}`);
  }

  const data = await res.json() as { result?: string; error?: string; meta?: unknown };
  if (data.error) throw new Error(data.error);
  if (data.meta !== undefined && data.meta !== null) onMeta?.(data.meta);
  return data.result ?? '';
}
