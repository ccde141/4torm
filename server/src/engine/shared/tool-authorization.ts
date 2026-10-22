import { loadAgent } from './agent-loader.js';
import type { AgentToolBinding } from './tool-defs-loader.js';
import { FrameworkError } from './framework-error.js';

export class ToolPermissionError extends FrameworkError {
  constructor(tool: string, agentId: string) {
    super({
      code: 'TOOL_PERMISSION_DENIED', kind: 'permission',
      message: `Agent ${agentId} 未获准使用工具：${tool}`,
      source: 'tool.executor', retryable: false,
    });
    this.name = 'ToolPermissionError';
  }
}

/** Resolve current bindings at invocation time, including revocations during a long run. */
export async function assertAgentToolAccess(
  dataDir: string, agentId: string, tool: string, args?: Record<string, string>,
): Promise<AgentToolBinding | undefined> {
  if (!agentId) {
    if (tool === 'use_skill') throw new ToolPermissionError(tool, '未指定');
    return undefined;
  }
  const agent = await loadAgent(dataDir, agentId);
  if (!agent) throw new ToolPermissionError(tool, agentId);
  if (tool === 'use_skill') {
    if (!args?.skill) throw new Error('缺少 skill 参数');
    if (!agent.skills.includes(args.skill)) throw new ToolPermissionError(`${tool}:${args.skill}`, agentId);
  }
  const { loadAgentToolBindings } = await import('./tool-defs-loader.js');
  const allowed = await loadAgentToolBindings(dataDir, agent.tools, agent.skills, agent.toolMode);
  const binding = allowed.find(item => item.definition.name === tool);
  if (!binding || (tool.startsWith('mcp:') && binding.source !== 'mcp')) {
    throw new ToolPermissionError(tool, agentId);
  }
  return binding;
}
