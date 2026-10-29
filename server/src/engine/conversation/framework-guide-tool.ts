import { readTaskboard, taskboardFile } from '../shared/taskboard.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import { MAIN_CAPABILITIES, renderMainCapabilityGuide } from './main-capabilities.js';
import { readAgentCollaborationCatalog } from '../collaboration/agent-gateway.js';

interface GuideToolInput {
  mainAgent: boolean;
  dataDir: string;
  agentId: string;
  sessionId?: string;
  args: Record<string, string>;
  toolDefs: readonly ToolDef[];
  /** Public feature metadata only; never used to authorize tools. */
  guideCatalog?: readonly ToolDef[];
}

export interface GuideToolResult {
  result: string;
  ok: boolean;
}

export function executeFrameworkGuideTool(input: GuideToolInput): GuideToolResult {
  if (!input.mainAgent || !input.sessionId) {
    return { result: '能力指南读取失败：当前入口未开放框架指南。', ok: false };
  }
  try {
    const capability = typeof input.args.capability === 'string' ? input.args.capability : '';
    const requestedView = input.args.view ?? (input.args.action ? 'tools' : 'guide');
    if (!['guide', 'tools'].includes(requestedView) || (requestedView === 'guide' && input.args.action)) {
      throw new Error('FRAMEWORK_GUIDE_INPUT_INVALID');
    }
    const view = requestedView === 'tools' ? 'tools' : 'guide';
    const known = MAIN_CAPABILITIES.some(entry => entry.id === capability)
      || input.toolDefs.some(tool => tool.frameworkCapability?.id === capability);
    const catalog = view === 'guide'
      ? input.guideCatalog ?? (known ? [] : readAgentCollaborationCatalog()) : [];
    const board = capability === 'board' && view === 'tools'
      ? readTaskboard(taskboardFile(input.dataDir, input.agentId, input.sessionId))
      : null;
    return {
      result: renderMainCapabilityGuide(capability, input.toolDefs, board, input.args.action,
        { view, catalog }),
      ok: true,
    };
  } catch (error) {
    return {
      result: (error as Error).message === 'FRAMEWORK_GUIDE_UNAVAILABLE'
        ? '操作定义读取失败：该能力当前未开放，请人类开启后再使用。'
        : (error as Error).message === 'FRAMEWORK_GUIDE_NOT_FOUND'
          ? '能力指南读取失败：未找到该功能区，请使用常驻介绍中的 capability 标识。'
          : `能力指南读取失败：${(error as Error).message}`,
      ok: false,
    };
  }
}
