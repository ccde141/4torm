import path from 'node:path';
import { buildConversationSystemPrompt } from '../../../engine/conversation/prompt-builder.js';
import { loadSessionToolSets } from '../../../engine/conversation/session-tool-assembly.js';
import type { SessionRunnerOpts } from '../../../engine/conversation/session-runner.js';
import type { LoadedAgent } from '../../../engine/shared/agent-loader.js';
import { resolveNativeMode } from '../../../engine/shared/llm-bridge.js';
import { SELF_LOOP_INSTRUCTION } from '../domain/self-loop.js';
import { TIDE_META } from '../domain/meta.js';

/** Build the same static input for execution and read-only context estimates. */
export async function buildTideInputContext(dataDir: string, agent: LoadedAgent, sessionId: string,
  input: { userMessage: string; selfLoop?: boolean; signal?: AbortSignal }) {
  const native = (await resolveNativeMode(dataDir, agent.model)).native;
  const opts: SessionRunnerOpts = {
    dataDir, agentId: agent.id, model: agent.model, temperature: agent.temperature,
    toolMediaScope: { feature: 'tide', target: { agentId: agent.id, sessionId } },
    toolNames: agent.tools, toolMode: agent.toolMode, skillIds: agent.skills,
    workspace: agent.workspace, sandboxLevel: agent.sandboxLevel,
    native, allowAsk: false, allowDelegate: false, signal: input.signal,
  };
  const tools = await loadSessionToolSets(opts);
  const projectDir = path.resolve(dataDir, '..');
  const rolePrompt = input.selfLoop ? agent.rolePrompt + SELF_LOOP_INSTRUCTION : agent.rolePrompt;
  const systemPrompt = await buildConversationSystemPrompt({
    rolePrompt, toolDefs: tools.guide, workspace: opts.workspace,
    workspaceAbs: path.resolve(projectDir, agent.workspace), projectDir,
    sandboxLevel: agent.sandboxLevel, skillIds: opts.skillIds, dataDir, agentId: agent.id,
    userMessage: input.userMessage, native, allowAsk: false, allowDelegate: false, surfaceMeta: TIDE_META,
  });
  return { opts, systemPrompt, rolePrompt, tools: native ? tools.runtime : undefined };
}
