import type { ChatMessage } from '../../types';
import type { PendingInput } from '../../engine/chat/input-outbox';
import type { InputDeliveryState } from '../../engine/chat/input-submission';

type SupportedLocale = 'zh-CN' | 'en-US';

export interface HumanInputActivity {
  runId: string;
  phase?: ChatMessage['streamingPhase'];
  ready?: boolean;
  closed?: boolean;
  compacting?: boolean;
}

const INPUT_STATUS_LABELS: Record<InputDeliveryState, [string, string]> = {
  sending: ['发送中', 'Sending'], received: ['已接收 · 等待处理', 'Received · pending processing'],
  queued: ['等待下一轮', 'Waiting for next turn'], included: ['已纳入上下文', 'Included in context'],
  continued: ['已转入下一轮', 'Continued'], retained: ['已保留 · 未消费', 'Retained · not consumed'],
};

/** Runtime hints describe the wait, never upgrade a receipt to inclusion or completion. */
export function humanInputStatus(state: InputDeliveryState, runId: string, locale: SupportedLocale,
  activity?: HumanInputActivity): string {
  const language = locale === 'en-US' ? 1 : 0;
  const current = activity?.runId === runId ? activity : undefined;
  if (state === 'sending' && current?.ready === false && !current.closed) {
    return language ? 'Pending send · waiting for execution to be ready' : '待发送 · 等待执行就绪';
  }
  if (state !== 'received' || !current) return INPUT_STATUS_LABELS[state][language];
  if (current.closed) return language ? 'Received · waiting for this turn to close' : '已接收 · 等待本轮结束';
  if (current.compacting) return language ? 'Received · waiting for compaction to finish' : '已接收 · 等待压缩结束';
  if (current.phase === 'tool-exec') {
    return language ? 'Received · waiting for the current tool to finish' : '已接收 · 等待当前工具结束';
  }
  if (current.phase === 'team-waiting') {
    return language ? 'Received · waiting for the main Agent to continue' : '已接收 · 等待主 Agent 继续';
  }
  if (current.phase === 'queued') return language ? 'Received · waiting for execution to be ready' : '已接收 · 等待执行就绪';
  if (current.phase === 'llm-waiting' || current.phase === 'model-output' || current.phase === 'tool-preparing') {
    return language ? 'Received · waiting for the current model response' : '已接收 · 等待本次模型响应';
  }
  return INPUT_STATUS_LABELS.received[language];
}

/** The outbox supplements the timeline; a durable receipt or next-turn message owns its display. */
export function unrepresentedHumanInputs(messages: readonly ChatMessage[], pending: readonly PendingInput[]): PendingInput[] {
  const users = new Set(messages.filter(message => message.role === 'user').map(message => message.id));
  const receipts = new Set(messages.flatMap(message => message.humanInputs ?? [])
    .map(input => `${input.runId}/${input.id}`));
  return pending.filter(({ input }) => !users.has(input.id) && !receipts.has(`${input.runId}/${input.id}`));
}

export function pendingUserRecovery(message: ChatMessage, pending: readonly PendingInput[],
  messages: readonly ChatMessage[]): PendingInput | undefined {
  if (message.role !== 'user' || messages.some(item => item.inputRunId === `followup-${message.id}`)) return undefined;
  return pending.find(entry => entry.input.id === message.id && entry.state === 'retained');
}

export interface SkippedInputNotice {
  prefix: string;
  names: string;
  reason: string;
}

const SKIP_REASON: Record<SupportedLocale, string> = {
  'zh-CN': '因人类插话取消，未执行；请根据新的要求重新决定后续操作。',
  'en-US': 'Cancelled by human steering; not executed. Reconsider the next action based on the new request.',
};

function skippedName(entry: string): string {
  const separator = entry.indexOf(':');
  return (separator >= 0 ? entry.slice(0, separator) : entry).trim();
}

export function summarizeSkippedInputNotice(entries: string[], locale: SupportedLocale): SkippedInputNotice | null {
  const names = [...new Set(entries.map(skippedName).filter(Boolean))];
  if (!names.length) return null;
  const english = locale === 'en-US';
  const separator = english ? '; ' : '；';
  const prefix = english ? 'Skipped tools: ' : '已跳过的工具：';
  const opening = english ? ' (' : '（';
  const closing = english ? ')' : '）';
  return { prefix, names: names.join(separator), reason: `${opening}${SKIP_REASON[locale]}${closing}` };
}

export function formatSkippedInputNotice(entries: string[], locale: SupportedLocale): string {
  const notice = summarizeSkippedInputNotice(entries, locale);
  return notice ? `${notice.prefix}${notice.names}${notice.reason}` : '';
}
