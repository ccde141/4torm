/**
 * 统一工具执行路由
 *
 * 判断工具来源：
 * - mcp:* → 走 MCP client 调用
 * - 其他 → 走 tool-bridge HTTP 代理
 *
 * 各引擎（信风/对流/季风）统一调用此函数。
 */

import { readToolBridgeResponse } from './tool-bridge-response';
import { readFileSync } from 'node:fs';
import { Agent, fetch as undiciFetch } from 'undici';
import type { McpInvocationOptions, McpToolOutcome } from './mcp-types.js';
import { legacyToolArguments, type ToolArguments } from './tool-arguments.js';
import { rememberToolImages, type ToolMediaAccess } from './tool-media-access.js';

let trustedBridge: { identity: string; agent: Agent } | undefined;

function bridgeDispatcher(): Agent {
  const certFile = process.env.FOURTORM_INTERNAL_CERT_FILE;
  if (!certFile) throw new Error('内部工具桥接缺少 TLS 证书');
  const servername = process.env.FOURTORM_INTERNAL_SERVERNAME || 'localhost';
  const identity = `${certFile}\0${servername}`;
  if (trustedBridge?.identity === identity) return trustedBridge.agent;
  const agent = new Agent({ connect: { ca: readFileSync(certFile), servername } });
  trustedBridge = { identity, agent };
  return agent;
}

const bridgeFetch: typeof fetch = async (input, init) => {
  if (init?.body !== undefined && typeof init.body !== 'string') {
    throw new Error('内部工具桥接只接受 JSON 文本请求');
  }
  return undiciFetch(String(input), {
    method: init?.method,
    headers: { ...Object.fromEntries(new Headers(init?.headers)),
      ...(process.env.FOURTORM_INTERNAL_TOKEN
        ? { 'x-4torm-internal-token': process.env.FOURTORM_INTERNAL_TOKEN } : {}) },
    body: init?.body ?? undefined,
    signal: init?.signal ?? undefined,
    dispatcher: bridgeDispatcher(),
  }) as unknown as Promise<Response>;
};

export interface ExecToolOpts {
  mediaAccess?: ToolMediaAccess;
  tool: string;
  args: ToolArguments;
  agentId: string;
  workspaceDir?: string;
  sandboxLevel?: string;
  signal?: AbortSignal;
  /** UI 侧通道：接收执行器回传的展示元数据（如覆盖写入旧内容），不影响 LLM 结果字符串 */
  onMeta?: (meta: unknown) => void;
  /** 后台执行句柄侧通道；正文仍原样回给模型。 */
  onObservationId?: (observationId: string) => void;
  observation?: { scope: 'conversation' | 'cyclone'; ownerId: string };
}

export interface ExecToolDeps {
  callMcp: (tool: string, args: ToolArguments, options?: McpInvocationOptions) => Promise<string>;
  callMcpOutcome?: (tool: string, args: ToolArguments, options?: McpInvocationOptions) => Promise<McpToolOutcome>;
  fetcher: typeof fetch;
}

const defaultDeps: ExecToolDeps = {
  callMcp: async (tool, args, options) => {
    const { callMcpTool } = await import('./mcp-manager.js');
    return callMcpTool(tool, args, options);
  },
  callMcpOutcome: async (tool, args, options) => {
    const { callMcpToolOutcome } = await import('./mcp-manager.js');
    return callMcpToolOutcome(tool, args, options);
  },
  fetcher: bridgeFetch,
};

export async function execToolUnified(
  opts: ExecToolOpts,
  deps: ExecToolDeps = defaultDeps,
): Promise<string> {
  if (opts.tool.startsWith('mcp:')) return deps.callMcp(opts.tool, opts.args, opts);
  return (await execLocalToolBridge(opts, deps)).result;
}

async function execLocalToolBridge(
  opts: ExecToolOpts, deps: ExecToolDeps,
): Promise<McpToolOutcome> {
  const {
    tool, args, agentId, workspaceDir, sandboxLevel, signal,
    onMeta, onObservationId, observation,
  } = opts;

  // 本地工具：走 tool-bridge HTTP
  const baseUrl = (process.env.TOOL_BRIDGE_URL || `https://localhost:${process.env.PORT || '3001'}`).replace(/\/+$/, '');
  const url = `${baseUrl}/api/tools/exec`;
  const body: Record<string, unknown> = { tool, args: legacyToolArguments(args), agentId };
  if (workspaceDir) body.workspaceDirOverride = workspaceDir;
  if (sandboxLevel) body.sandboxLevelOverride = sandboxLevel;
  if (observation) body.observation = observation;

  const res = await deps.fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const data = await readToolBridgeResponse(res);
  if (data.meta !== undefined && data.meta !== null) onMeta?.(data.meta);
  if (data.observationId) onObservationId?.(data.observationId);
  return { result: data.result, ok: data.ok, ...(data.toolImages?.length ? { toolImages: data.toolImages } : {}) };
}

/** Status-aware route for ToolCaller; the string API above remains available. */
export async function execToolUnifiedOutcome(
  opts: ExecToolOpts, deps: ExecToolDeps = defaultDeps,
): Promise<McpToolOutcome> {
  if (opts.tool.startsWith('mcp:')) {
    const outcome = deps.callMcpOutcome ? await deps.callMcpOutcome(opts.tool, opts.args, opts)
      : { result: await deps.callMcp(opts.tool, opts.args, opts), ok: true };
    if (opts.mediaAccess) rememberToolImages(opts.mediaAccess, outcome.toolImages);
    return outcome;
  }
  const outcome = await execLocalToolBridge(opts, deps);
  if (opts.mediaAccess) rememberToolImages(opts.mediaAccess, outcome.toolImages);
  return outcome;
}
