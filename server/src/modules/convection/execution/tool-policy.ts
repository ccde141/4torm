import type { ToolDef } from '../../../engine/shared/tool-defs-loader.js';

/** Convection does not provide an interactive browser surface. */
export function convectionSkillIds(skills: string[]): string[] {
  return skills.filter(skill => skill !== 'browser');
}

export function convectionTools(tools: ToolDef[]): ToolDef[] {
  return tools.filter(tool => tool.name !== 'browser');
}

export function assertConvectionToolAllowed(tool: string, args: Record<string, unknown>): void {
  if (tool === 'browser' || (tool === 'use_skill' && args.skill === 'browser')) {
    throw new Error('对流未开放交互式浏览器工具');
  }
}
