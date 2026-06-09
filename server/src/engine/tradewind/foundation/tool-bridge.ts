/**
 * 工具桥接 —— 通过 loopback HTTP 调 4torm 主干 /api/tools/exec
 *
 * 设计依据：tradewind-build-guide.md §2.2（HTTP 隔离原则）
 * 决策依据：信风未来可独立部署，因此跨模块调用一律走 HTTP，不直接 import 主干函数。
 *
 * 关键点：
 * - 强制传 workspaceDirOverride = "data/tradewind/workflows/{wfId}/workspace"（相对项目根）
 * - 工作流 ID sanitize：禁止 .. 和绝对路径，特殊字符替换为 _
 * - 错误：HTTP 非 2xx 或 result 含错误字符串都按真实失败抛出（不重试）
 *
 * 未来独立部署时只需改 BASE_URL（或参数化）。
 */

import path from 'node:path';

/** dev server loopback 地址。环境变量 TRADEWIND_BASE_URL 可覆盖 */
const DEFAULT_BASE_URL = 'http://localhost:3001';

function getBaseUrl(): string {
  return process.env.TRADEWIND_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

/**
 * 工作流 ID 合法化：替换不安全字符，禁止路径穿越。
 * 与沙盒约定一致（同样基于 path token 黑名单替换）。
 */
export function sanitizeWorkflowId(wfId: string): string {
  if (!wfId || typeof wfId !== 'string') {
    throw new Error('workflowId 不能为空');
  }
  // 禁绝对路径与路径穿越
  if (wfId.includes('..') || path.isAbsolute(wfId)) {
    throw new Error(`workflowId 含非法路径片段：${wfId}`);
  }
  // 沙盒同款替换规则
  return wfId.replace(/[\\/:*?"<>| ]/g, '_');
}

/**
 * 构造工作流共享 workspace 的相对路径（项目根相对）。
 * 主干 executeTool 会 path.resolve(DATA_DIR, '..', override) 拼绝对路径。
 */
export function buildWorkflowWorkspace(wfId: string): string {
  const safe = sanitizeWorkflowId(wfId);
  // 用 posix 风格分隔符（HTTP 传输路径，跨平台一致）
  return `data/tradewind/workflows/${safe}/workspace`;
}

export interface ToolCallParams {
  /** 工具名（如 read_file / write_file / run_command） */
  tool: string;
  /** 工具参数（字符串字典，符合主干 executeTool 期望） */
  args: Record<string, string>;
  /** 工作流 ID（用于解析 workspace 路径；传了 workspaceDirOverride 时可省略） */
  workflowId?: string;
  /** Agent ID（用于工具权限校验） */
  agentId: string;
  /** 直接指定 workspace 相对路径（项目根相对）。传了则忽略 workflowId 的路径推导 */
  workspaceDirOverride?: string;
}

export interface ToolCallResult {
  /** 工具输出（成功）或错误信息（失败时也可能在这里，取决于工具实现） */
  result: string;
}

/** 工具调用超时（毫秒）。环境变量 TOOL_EXEC_TIMEOUT_MS 可覆盖 */
const TOOL_TIMEOUT_MS = parseInt(process.env.TOOL_EXEC_TIMEOUT_MS || '30000', 10);

/**
 * 调一次工具。
 *
 * 失败处理：HTTP 非 2xx 直接抛错（与 llm-bridge 风格一致）。
 * 超时处理：超过 TOOL_TIMEOUT_MS 自动 abort，抛出超时错误。
 * 注意：工具本身的"业务错误"（如文件不存在）通常通过 result 字符串返回 2xx，
 *      上层 tool-runner 负责把这种字符串原样塞回 LLM 上下文。
 */
export async function callTool(params: ToolCallParams): Promise<string> {
  const { tool, args, workflowId, agentId, workspaceDirOverride } = params;

  if (!tool) throw new Error('tool 名不能为空');
  if (!workflowId && !workspaceDirOverride) throw new Error('workflowId 或 workspaceDirOverride 至少传一个');

  const workspace = workspaceDirOverride || buildWorkflowWorkspace(workflowId!);
  const url = getBaseUrl().replace(/\/+$/, '') + '/api/tools/exec';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool,
        args,
        agentId,
        workspaceDirOverride: workspace,
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
      throw new Error(`工具 ${tool} 执行超时（${TOOL_TIMEOUT_MS}ms）`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
