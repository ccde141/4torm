import type { CycloneDispatch } from './dispatch-timeline.js';
import { isCancelledToolResult } from './tool-result-status.js';

const SYSTEM_TOOLS = new Set(['task_board', 'use_skill', 'dispatch', 'bulletin']);

export type CycloneSystemToolStatus = 'running' | 'success' | 'error' | 'cancelled';

export interface CycloneSystemToolDetail {
  title: string;
  state: string;
  status: CycloneSystemToolStatus;
  preview?: string;
}

interface DescribeInput {
  tool: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'running' | 'success' | 'error';
  dispatches: CycloneDispatch[];
}

export function isCycloneSystemTool(tool: string): boolean {
  return SYSTEM_TOOLS.has(tool.trim().toLowerCase());
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function baseState(input: DescribeInput): Pick<CycloneSystemToolDetail, 'state' | 'status'> {
  if (isCancelledToolResult(input.result)) return { state: '已取消', status: 'cancelled' };
  if (input.status === 'running') return { state: '执行中', status: 'running' };
  if (input.status === 'error') return { state: '执行失败', status: 'error' };
  return { state: '已完成', status: 'success' };
}

function dispatchId(result?: string): string | undefined {
  return result?.match(/任务 ID[：:]\s*([\w-]+)/)?.[1];
}

function describeDispatch(input: DescribeInput): CycloneSystemToolDetail {
  const target = text(input.args.target) || '目标工位';
  const item = input.dispatches.find(candidate => candidate.id === dispatchId(input.result));
  if (!item) return { title: `异步派发 → ${target}`, ...baseState(input), preview: text(input.args.task) };
  const states: Record<CycloneDispatch['status'], Pick<CycloneSystemToolDetail, 'state' | 'status'>> = {
    queued: { state: '等待目标工位', status: 'running' },
    running: { state: '目标工位执行中', status: 'running' },
    awaiting_human: { state: '目标工位等待回答', status: 'running' },
    completed: { state: '异步任务已完成', status: 'success' },
    failed: { state: '异步任务失败', status: 'error' },
  };
  return {
    title: `异步派发 → ${item.targetSeatTitle || target}`,
    ...states[item.status],
    preview: item.error || item.response || item.task,
  };
}

export function describeCycloneSystemTool(input: DescribeInput): CycloneSystemToolDetail | null {
  const tool = input.tool.trim().toLowerCase();
  if (!isCycloneSystemTool(tool)) return null;
  if (tool === 'dispatch') return describeDispatch(input);
  if (tool === 'use_skill') {
    return { title: `加载技能 · ${text(input.args.skill) || '未命名'}`, ...baseState(input) };
  }
  if (tool === 'task_board') {
    const action = text(input.args.action);
    const label = action === 'clear' ? '清空' : action === 'add' ? '添加任务' : '更新';
    return { title: `任务板 · ${label}`, ...baseState(input), preview: text(input.args.goal) || undefined };
  }
  const bulletinAction: Record<string, string> = {
    add: '添加条目', remove: '删除条目', update: '更新条目', clear: '清空',
  };
  const action = text(input.args.action);
  return {
    title: `公告板 · ${bulletinAction[action] || '更新'}`,
    ...baseState(input),
    preview: text(input.args.text) || undefined,
  };
}
