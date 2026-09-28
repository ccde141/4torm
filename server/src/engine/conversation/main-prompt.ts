import type { PromptBuildOpts } from './prompt-builder.js';
import { buildSandboxSection } from '../shared/sandbox-prompt.js';
import { buildTextToolProtocol, buildSelfManagementSection } from '../shared/prompt.js';
import { buildMemoryToolDefs, recallMemory } from '../shared/agent-memory.js';
import { buildBackgroundExecutionToolDefs } from '../shared/background-execution-tools.js';
import { readTaskboard, taskboardFile } from '../shared/taskboard.js';
import { buildVirtualToolDefs } from './virtual-tools.js';
import { withMainToolGuidance, renderMainToolDefinitions, MAIN_WORKFLOW_CONTRACT } from './main-tool-defs.js';
import { MAIN_IDENTITY, MAIN_COLLABORATION, MAIN_ORGANIZATION, MAIN_WORK_SHAPE_CHECK, MAIN_COMPLETION,
  MAIN_CAPABILITY_GUIDANCE as guidance } from './main-guidance.js';
import { MAIN_CAPABILITIES, renderCapabilityRouter } from './main-capabilities.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';

function frameworkDefinitions(opts: PromptBuildOpts): ToolDef[] {
  return withMainToolGuidance([
    ...buildVirtualToolDefs(true, !!opts.sessionId, !!opts.sessionId,
      { allowAsk: opts.allowAsk, allowDelegate: false }),
    ...(opts.sessionId ? buildBackgroundExecutionToolDefs() : []),
    ...buildMemoryToolDefs(),
  ]);
}

function capabilitySections(opts: PromptBuildOpts, defs: ToolDef[]): string[] {
  const active = MAIN_CAPABILITIES.filter(capability =>
    capability.tools.some(name => defs.some(def => def.name === name)));
  const section = (capability: (typeof MAIN_CAPABILITIES)[number]) => {
    const tools = defs.filter(def => capability.tools.includes(def.name));
    const definitions = opts.native ? '' : renderMainToolDefinitions(tools);
    const fields = opts.native && capability.nativeSchemaTools
      ? renderMainToolDefinitions(tools.filter(def => capability.nativeSchemaTools!.includes(def.name))) : '';
    const extra = capability.detail === 'workflow-contract' ? MAIN_WORKFLOW_CONTRACT
      : capability.detail === 'taskboard-state'
        ? `set/clear 使用当前 expectedRevision；空板为0，冲突后先 get 再合并。当前任务板：\n${JSON.stringify(board)}`
        : '';
    return [capability.guidance, extra, definitions, fields].filter(Boolean).join('\n\n');
  };
  const board = opts.sessionId ? readTaskboard(taskboardFile(opts.dataDir, opts.agentId, opts.sessionId)) : null;
  const workShapeCheck = active.some(capability => capability.id === 'team')
    ? MAIN_WORK_SHAPE_CHECK : '';
  return [workShapeCheck, renderCapabilityRouter(active), ...active.map(section)];
}

/** 仅季风主会话使用；历史与提供商适配仍由原调用链处理。 */
export async function buildMainAgentPrompt(opts: PromptBuildOpts): Promise<string> {
  const teamDefs = opts.toolDefs.filter(def => def.name.startsWith('team_'));
  const configured = opts.toolDefs.filter(def => !def.name.startsWith('team_'));
  const defs = [...frameworkDefinitions(opts), ...teamDefs];
  const protocol = opts.native
    ? '使用本次运行提供的原生工具通道调用工具，依据结果继续工作；无需调用时直接自然语言回应。'
    : buildTextToolProtocol(configured);
  const parts = [MAIN_IDENTITY, buildSandboxSection({
    workspaceAbs: opts.workspaceAbs, projectDir: opts.projectDir,
    sandboxLevel: opts.sandboxLevel, workspaceLabel: '当前工作空间',
  }), MAIN_COLLABORATION, protocol];
  parts.push(MAIN_ORGANIZATION, ...capabilitySections(opts, defs));
  // 保持现有召回失败不阻断会话的行为。
  try {
    const memory = await recallMemory(opts.dataDir, opts.agentId, opts.userMessage);
    if (memory) parts.push(memory);
  } catch { /* 与原构建器相同的召回降级 */ }
  parts.push(guidance.extension, buildSelfManagementSection({
    allowToolRegistration: !!opts.sessionId, native: opts.native,
  }));
  if (!opts.native) parts.push(renderMainToolDefinitions(defs.filter(def => def.name === 'register_tool')));
  parts.push(guidance.review, opts.native ? '使用 review_changes 查看本轮文件改动。'
    : renderMainToolDefinitions(defs.filter(def => def.name === 'review_changes')));
  parts.push(MAIN_COMPLETION);
  if (opts.rolePrompt.trim()) parts.push(`## 角色设定\n\n${opts.rolePrompt.trim()}`);
  return parts.filter(Boolean).join('\n\n');
}
