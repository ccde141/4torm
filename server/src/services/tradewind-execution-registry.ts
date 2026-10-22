import path from 'node:path';
import type { Orchestrator, LoopController } from '../engine/tradewind/orchestrator/index.js';
import { frameworkError } from '../engine/shared/framework-error.js';
import { executionIdentityRequired } from '../engine/tradewind/execution/execution-registry.js';

export interface TradewindExecutionIdentity { executionId?: string; workflowId?: string; dataDir?: string }
export interface TradewindExecutionSlot {
  dataDir: string;
  workflowId: string;
  startedAt: string;
  starting: boolean;
  cancelled: boolean;
  orchestrator: Orchestrator | null;
  loop: LoopController | null;
  whenStarted: Promise<void>;
  finishStarting(): void;
}
const slots = new Map<string, TradewindExecutionSlot>();

export function slotIsRunning(slot: TradewindExecutionSlot): boolean {
  return slot.starting || !!(slot.loop?.isRunning() || slot.orchestrator?.isRunning());
}

export function getTradewindExecutions(dataDir?: string): TradewindExecutionSlot[] {
  return [...slots.values()].filter(slot => !dataDir || normalizedRoot(slot.dataDir) === normalizedRoot(dataDir));
}

export function selectTradewindExecution(identity?: TradewindExecutionIdentity | string): TradewindExecutionSlot | undefined {
  const target = typeof identity === 'string' ? { executionId: identity } : identity;
  const all = getTradewindExecutions(target?.dataDir);
  if (target?.executionId || target?.workflowId) {
    const matches = all.filter(slot =>
    (!target.workflowId || slot.workflowId === target.workflowId)
    && (!target.executionId || slot.orchestrator?.getExecutionId() === target.executionId));
    if (matches.length > 1) throw executionIdentityRequired();
    return matches[0];
  }
  const active = all.filter(slotIsRunning);
  const candidates = active.length ? active : all.filter(slot => slot.orchestrator);
  if (candidates.length > 1) throw executionIdentityRequired();
  return candidates[0];
}

export function reserveTradewindExecution(dataDir: string, workflowId: string): TradewindExecutionSlot {
  const key = slotKey(dataDir, workflowId);
  const prior = slots.get(key);
  if (prior && slotIsRunning(prior)) throw frameworkError({ code: 'TRADEWIND_EXECUTION_BUSY',
    kind: 'conflict', message: '当前信风工作流正在运行', source: 'tradewind.execution', retryable: false });
  let finishStarting!: () => void;
  const whenStarted = new Promise<void>(resolve => { finishStarting = resolve; });
  const slot: TradewindExecutionSlot = { dataDir, workflowId, startedAt: new Date().toISOString(),
    starting: true, cancelled: false, orchestrator: null, loop: null, whenStarted, finishStarting };
  slots.set(key, slot);
  return slot;
}

export function finishTradewindStart(slot: TradewindExecutionSlot): void {
  slot.starting = false;
  slot.finishStarting();
  const key = slotKey(slot.dataDir, slot.workflowId);
  if (!slot.orchestrator && slots.get(key) === slot) slots.delete(key);
}

export function forgetTradewindExecution(workflowId: string, dataDir: string): void {
  const key = slotKey(dataDir, workflowId);
  const slot = slots.get(key);
  if (slot && !slotIsRunning(slot)) slots.delete(key);
}

function normalizedRoot(dataDir: string): string {
  const root = path.resolve(dataDir);
  return process.platform === 'win32' ? root.toLowerCase() : root;
}
export function sameTradewindDataRoot(left: string, right: string): boolean {
  return normalizedRoot(left) === normalizedRoot(right);
}
function slotKey(dataDir: string, workflowId: string): string { return JSON.stringify([normalizedRoot(dataDir), workflowId]); }
