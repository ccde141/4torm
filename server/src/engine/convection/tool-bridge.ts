/** Convection's feature adapter for the shared tool execution channel. */

import { execToolUnified, type ExecToolDeps } from '../shared/exec-tool.js';

export interface ConvectionToolCallParams {
  tool: string;
  args: Record<string, string>;
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
  return execToolUnified({
    tool: params.tool,
    args: params.args,
    agentId: params.agentId,
    workspaceDir: params.workspaceDir,
    signal: params.signal,
  }, deps);
}
