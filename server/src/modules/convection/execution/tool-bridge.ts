/** Convection's feature adapter for the shared tool execution channel. */

import {
  execToolUnified, execToolUnifiedOutcome, type ExecToolDeps,
} from '../../../engine/shared/exec-tool.js';
import type { McpToolOutcome } from '../../../engine/shared/mcp-types.js';
import { assertConvectionToolAllowed } from './tool-policy.js';

export interface ConvectionToolCallParams {
  mediaAccess?: import('../../../engine/shared/tool-media-access.js').ToolMediaAccess;
  tool: string;
  args: Record<string, unknown>;
  agentId: string;
  workspaceDir: string;
  signal?: AbortSignal;
}

/** Execute one tool call. Feature-owned virtual tools are handled before this adapter. */
export async function callTool(
  params: ConvectionToolCallParams,
  deps?: ExecToolDeps,
): Promise<string> {
  if (!params.tool) throw new Error('tool name must not be empty');
  assertConvectionToolAllowed(params.tool, params.args);
  return execToolUnified({
    tool: params.tool,
    args: params.args,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    signal: params.signal,
  }, deps);
}

/** Execute one tool call while retaining the executor's success status. */
export async function callToolOutcome(
  params: ConvectionToolCallParams,
  deps?: ExecToolDeps,
): Promise<McpToolOutcome> {
  if (!params.tool) throw new Error('tool name must not be empty');
  assertConvectionToolAllowed(params.tool, params.args);
  return execToolUnifiedOutcome({
    mediaAccess: params.mediaAccess,
    tool: params.tool,
    args: params.args,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    signal: params.signal,
  }, deps);
}
