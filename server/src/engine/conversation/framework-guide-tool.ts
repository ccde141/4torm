import { readTaskboard, taskboardFile } from '../shared/taskboard.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import { renderMainCapabilityGuide } from './main-capabilities.js';

interface GuideToolInput {
  mainAgent: boolean;
  dataDir: string;
  agentId: string;
  sessionId?: string;
  args: Record<string, string>;
  toolDefs: readonly ToolDef[];
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
    const board = capability === 'board'
      ? readTaskboard(taskboardFile(input.dataDir, input.agentId, input.sessionId))
      : null;
    return {
      result: renderMainCapabilityGuide(capability, input.toolDefs, board, input.args.action),
      ok: true,
    };
  } catch (error) {
    return {
      result: (error as Error).message === 'FRAMEWORK_GUIDE_UNAVAILABLE'
        ? '能力指南读取失败：该能力当前未开放。'
        : `能力指南读取失败：${(error as Error).message}`,
      ok: false,
    };
  }
}
