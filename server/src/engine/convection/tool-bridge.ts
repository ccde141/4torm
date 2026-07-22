/**
 * 对流工具桥接 —— 独立于信风，自主演化
 *
 * 通过 loopback HTTP 调 4torm 主干 /api/tools/exec。
 * 与信风 tool-bridge 的区别：
 * - 不需要 workflowId / sanitizeWorkflowId / buildWorkflowWorkspace
 * - 直接传 workspaceDirOverride（对流 session workspace 路径）
 * - 更简洁的接口
 */

import { callMcpTool } from '../shared/mcp-manager.js';

/** dev server loopback 地址。环境变量 TRADEWIND_BASE_URL 可覆盖 */
const DEFAULT_BASE_URL = 'http://localhost:3001';

function getBaseUrl(): string {
  return process.env.TRADEWIND_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

export interface ConvectionToolCallParams {
  /** 工具名 */
  tool: string;
  /** 工具参数 */
  args: Record<string, string>;
  /** Agent ID（用于工具权限校验） */
  agentId: string;
  /** workspace 相对路径（项目根相对） */
  workspaceDir: string;
}

interface ToolCallResult {
  result: string;
}

interface ConvectionToolDeps {
  callMcp: (tool: string, args: Record<string, string>) => Promise<string>;
  fetcher: typeof fetch;
}

const defaultDeps: ConvectionToolDeps = {
  callMcp: callMcpTool,
  fetcher: fetch,
};

/** 工具调用超时（毫秒） */
const TOOL_TIMEOUT_MS = parseInt(process.env.TOOL_EXEC_TIMEOUT_MS || '30000', 10);

async function callLocalTool(
  params: ConvectionToolCallParams,
  fetcher: typeof fetch,
): Promise<string> {
  const { tool, args, agentId, workspaceDir } = params;
  const url = getBaseUrl().replace(/\/+$/, '') + '/api/tools/exec';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

  try {
    const res = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool,
        args,
        agentId,
        workspaceDirOverride: workspaceDir,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`工具调用 HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = (await res.json().catch(() => null)) as ToolCallResult | { error?: string } | null;
    if (!data) throw new Error('工具调用返回非 JSON');
    if ('error' in data && data.error) throw new Error(`工具调用错误：${data.error}`);
    if (typeof (data as ToolCallResult).result !== 'string') {
      throw new Error('工具调用返回结构异常：缺少 result 字段');
    }

    return (data as ToolCallResult).result;
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new Error(`工具 ${tool} 执行超时（${TOOL_TIMEOUT_MS}ms）`, { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 调一次工具。失败直接抛错，不重试。 */
export async function callTool(
  params: ConvectionToolCallParams,
  deps: ConvectionToolDeps = defaultDeps,
): Promise<string> {
  if (!params.tool) throw new Error('tool 名不能为空');
  if (params.tool.startsWith('mcp:')) {
    return deps.callMcp(params.tool, params.args);
  }
  return callLocalTool(params, deps.fetcher);
}
