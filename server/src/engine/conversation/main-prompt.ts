import type { PromptBuildOpts } from './prompt-builder.js';
import { buildSandboxSection } from '../shared/sandbox-prompt.js';
import { buildTextToolProtocol, buildSelfManagementSection } from '../shared/prompt.js';
import { buildFrameworkNavigationSection } from '../shared/framework-navigation.js';
import { buildMemoryToolDefs, recallMemory } from '../shared/agent-memory.js';
import { buildBackgroundExecutionToolDefs } from '../shared/background-execution-tools.js';
import { buildVirtualToolDefs } from './virtual-tools.js';
import { withMainToolGuidance, renderMainToolDefinitions } from './main-tool-defs.js';
import { MAIN_IDENTITY, MAIN_COLLABORATION, MAIN_ORGANIZATION, MAIN_WORK_SHAPE_CHECK, MAIN_COMPLETION,
  MAIN_CAPABILITY_GUIDANCE as guidance } from './main-guidance.js';
import { activeMainCapabilities, renderCapabilityRouter } from './main-capabilities.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';

function frameworkDefinitions(opts: PromptBuildOpts): ToolDef[] {
  return withMainToolGuidance([
    ...buildVirtualToolDefs(!!opts.sessionId,
      { allowAsk: opts.allowAsk, allowDelegate: false, allowFrameworkStatus: !!opts.sessionId }),
    ...(opts.sessionId ? buildBackgroundExecutionToolDefs() : []),
    ...buildMemoryToolDefs(),
  ]);
}

function capabilitySections(
  opts: PromptBuildOpts,
  defs: ToolDef[],
  configuredNames: ReadonlySet<string>,
): string[] {
  const active = activeMainCapabilities(defs).filter(capability =>
    capability.id !== 'skill' || opts.skillIds.length > 0);
  const workShapeCheck = active.some(capability => capability.id === 'team'
    && (capability.tools.includes('team_start') || (capability.tools.includes('team_create')
      && capability.tools.includes('team_dispatch'))))
    ? MAIN_WORK_SHAPE_CHECK : '';
  const activeNames = new Set(active.flatMap(capability => capability.tools));
  const definitions = opts.native ? '' : renderMainToolDefinitions(defs.filter(definition =>
    activeNames.has(definition.name) && !configuredNames.has(definition.name)));
  return [workShapeCheck, renderCapabilityRouter(active), definitions];
}

/** 仅季风主会话使用；历史与提供商适配仍由原调用链处理。 */
export async function buildMainAgentPrompt(opts: PromptBuildOpts): Promise<string> {
  const framework = frameworkDefinitions(opts);
  const frameworkNames = new Set(framework.map(definition => definition.name));
  const teamDefs = opts.toolDefs.filter(def => def.name.startsWith('team_'));
  const configured = opts.toolDefs.filter(def =>
    !def.name.startsWith('team_') && !frameworkNames.has(def.name));
  const defs = [...framework, ...configured, ...teamDefs];
  const protocol = opts.native
    ? '使用本次运行提供的原生工具通道调用工具，依据结果继续工作；无需调用时直接自然语言回应。'
    : buildTextToolProtocol(configured);
  const parts = [MAIN_IDENTITY, buildSandboxSection({
    workspaceAbs: opts.workspaceAbs, projectDir: opts.projectDir,
    sandboxLevel: opts.sandboxLevel, workspaceLabel: '当前工作空间',
  }), buildFrameworkNavigationSection(), MAIN_COLLABORATION, protocol];
  parts.push(MAIN_ORGANIZATION, ...capabilitySections(
    opts, defs, new Set(configured.map(definition => definition.name)),
  ));
  // 保持现有召回失败不阻断会话的行为。
  try {
    const memory = await recallMemory(opts.dataDir, opts.agentId, opts.userMessage);
    if (memory) parts.push(memory);
  } catch { /* 与原构建器相同的召回降级 */ }
  parts.push(guidance.extension, buildSelfManagementSection({
    allowToolRegistration: !!opts.sessionId, native: opts.native, includeNavigation: false,
  }));
  if (!opts.native) parts.push(renderMainToolDefinitions(defs.filter(def => def.name === 'register_tool')));
  parts.push(guidance.review, opts.native ? '使用 review_changes 查看本轮文件改动。'
    : renderMainToolDefinitions(defs.filter(def => def.name === 'review_changes')));
  parts.push(MAIN_COMPLETION);
  if (opts.rolePrompt.trim()) parts.push(`## 角色设定\n\n${opts.rolePrompt.trim()}`);
  return parts.filter(Boolean).join('\n\n');
}
