import type { CycloneDispatch } from './dispatch-timeline.js';
import { isCancelledToolResult } from './tool-result-status.js';
import type { MessageKey, MessageValues } from '../../../i18n/locale.js';

type Translate = (key: MessageKey, values?: MessageValues) => string;

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
  t?: Translate;
}

export function isCycloneSystemTool(tool: string): boolean {
  return SYSTEM_TOOLS.has(tool.trim().toLowerCase());
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function tr(input: DescribeInput, key: MessageKey, fallback: string, values?: MessageValues): string {
  return input.t ? input.t(key, values) : fallback;
}

function baseState(input: DescribeInput): Pick<CycloneSystemToolDetail, 'state' | 'status'> {
  if (isCancelledToolResult(input.result)) return { state: tr(input, 'cyclone.system.cancelled', '已取消'), status: 'cancelled' };
  if (input.status === 'running') return { state: tr(input, 'cyclone.system.running', '执行中'), status: 'running' };
  if (input.status === 'error') return { state: tr(input, 'cyclone.system.failed', '执行失败'), status: 'error' };
  return { state: tr(input, 'cyclone.system.completed', '已完成'), status: 'success' };
}

function dispatchId(result?: string): string | undefined {
  return result?.match(/任务 ID[：:]\s*([\w-]+)/)?.[1];
}

function describeDispatch(input: DescribeInput): CycloneSystemToolDetail {
  const target = text(input.args.target) || tr(input, 'cyclone.system.targetSeat', '目标工位');
  const item = input.dispatches.find(candidate => candidate.id === dispatchId(input.result));
  if (!item) return { title: tr(input, 'cyclone.system.dispatch', `异步派发 → ${target}`, { target }), ...baseState(input), preview: text(input.args.task) };
  const states: Record<CycloneDispatch['status'], Pick<CycloneSystemToolDetail, 'state' | 'status'>> = {
    queued: { state: tr(input, 'cyclone.dispatch.targetStatus.queued', '等待目标工位'), status: 'running' },
    running: { state: tr(input, 'cyclone.dispatch.targetStatus.running', '目标工位执行中'), status: 'running' },
    awaiting_human: { state: tr(input, 'cyclone.dispatch.targetStatus.awaitingHuman', '目标工位等待回答'), status: 'running' },
    completed: { state: tr(input, 'cyclone.dispatch.targetStatus.completed', '异步任务已完成'), status: 'success' },
    failed: { state: tr(input, 'cyclone.dispatch.targetStatus.failed', '异步任务失败'), status: 'error' },
  };
  const resolvedTarget = item.targetSeatTitle || target;
  return {
    title: tr(input, 'cyclone.system.dispatch', `异步派发 → ${resolvedTarget}`, { target: resolvedTarget }),
    ...states[item.status],
    preview: item.error || item.response || item.task,
  };
}

export function describeCycloneSystemTool(input: DescribeInput): CycloneSystemToolDetail | null {
  const tool = input.tool.trim().toLowerCase();
  if (!isCycloneSystemTool(tool)) return null;
  if (tool === 'dispatch') return describeDispatch(input);
  if (tool === 'use_skill') {
    const skill = text(input.args.skill) || tr(input, 'cyclone.system.unnamed', '未命名');
    return { title: tr(input, 'cyclone.system.skill', `加载技能 · ${skill}`, { skill }), ...baseState(input) };
  }
  if (tool === 'task_board') {
    const action = text(input.args.action);
    const label = action === 'clear' ? tr(input, 'cyclone.system.clear', '清空')
      : action === 'add' ? tr(input, 'cyclone.system.addTask', '添加任务') : tr(input, 'cyclone.system.update', '更新');
    return { title: tr(input, 'cyclone.system.taskBoard', `任务板 · ${label}`, { action: label }), ...baseState(input), preview: text(input.args.goal) || undefined };
  }
  const bulletinAction: Record<string, [MessageKey, string]> = {
    add: ['cyclone.system.addItem', '添加条目'], remove: ['cyclone.system.removeItem', '删除条目'],
    update: ['cyclone.system.updateItem', '更新条目'], clear: ['cyclone.system.clear', '清空'],
  };
  const action = text(input.args.action);
  const actionCopy = bulletinAction[action] ?? ['cyclone.system.update', '更新'];
  const label = tr(input, actionCopy[0], actionCopy[1]);
  return {
    title: tr(input, 'cyclone.system.bulletin', `公告板 · ${label}`, { action: label }),
    ...baseState(input),
    preview: text(input.args.text) || undefined,
  };
}
