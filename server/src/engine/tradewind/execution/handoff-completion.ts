import type { EnvelopeDraft } from './envelope-draft.js';
import { handoffError, type HandoffSelection } from '../foundation/handoff-target.js';

/** 两种模型协议共用最后一层封口校验；异常兜底文本绝不能代替明确选路。 */
export function resolveHandoffCompletion<T extends { autoOutcome?: 'completed' | 'anomaly'; termination: { status: string } }>(
  result: T, draft: EnvelopeDraft | null, required: boolean,
): T & { target?: HandoffSelection } {
  if (!required || result.termination.status === 'aborted' || result.termination.status === 'failed') return result;
  const target = draft?.getSelectedTarget();
  if (!target || result.autoOutcome !== 'completed') throw handoffError(
    'TRADEWIND_HANDOFF_NOT_SEALED', '节点没有完成有效的单目标封口，未向下游派发');
  return { ...result, target };
}
