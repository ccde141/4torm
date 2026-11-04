import { RECALL_PREFIX } from './delivery.js';
import { recallObject } from './storage.js';
import type { ContextMessage } from '../types.js';
import type { RecallPending, RecallSessionState, RecallSources } from './contracts.js';
import type { RecallCard, RecallCandidateRecord } from './contracts.js';
import { lexicalScore } from './retrieval.js';
import { randomUUID } from 'node:crypto';
import { MAX_PENDING_RECALL_CARDS } from './budget.js';

export function reusableRecallPending(query: string, fresh: RecallCard[], pending: RecallPending[]): RecallPending[] {
  const previous = pending.filter(card => card.status === 'ready');
  const switched = /换(?:个|一[个下])?(?:话题|项目|任务)|先不聊|另一个项目|新(?:的)?(?:任务|项目)|\bnew (?:task|project|topic)\b/i.test(query)
    || fresh.length > 0 && previous.length > 0 && fresh.every(card => previous.every(old => old.id !== card.id))
    && lexicalScore(query, previous.map(card => `${card.title} ${card.scope ?? ''}`).join(' ')) === 0;
  const continuing = /^(?:继续|接着|下一步|按这个|照这个|就这样|continue|go on)[。！？!?\s]*$/i.test(query);
  return switched ? [] : previous.filter(card => {
    const content = `${card.title} ${card.text} ${card.scope ?? ''}`;
    const priorHuman = card.context.filter(message => message.role === 'user').at(-1)?.content;
    const sameTask = !!priorHuman && lexicalScore(topic(priorHuman), topic(query)) === 1 && lexicalScore(query, content) > 0;
    if (continuing) return true;
    // A prepared model selection belongs to its task, even if a generic keyword matches another task.
    if (card.level === 'L2' && priorHuman) return sameTask;
    return sameTask || fresh.some(item => item.id === card.id) || lexicalScore(query, content) >= .5;
  });
}

function topic(query: string): string {
  return query.trim().replace(/^(?:(?:请|帮我|我们|继续|接着|下一步|开始|再|修改|调整|检查|处理|完善|优化)[，,\s]*)+/u, '')
    .replace(/^(?:(?:please|continue|update|change|check)\s+)+/i, '');
}

export function stageRecallCards(state: RecallSessionState, selected: RecallCard[], reusable: RecallPending[],
  candidates: RecallCandidateRecord[], error?: string): RecallSessionState {
  const deliveryId = randomUUID(), pending = state.pending ?? [];
  const staged = selected.map(card => {
    const original = pending.find(item => item.id === card.id && item.revision === card.revision);
    return { ...card, status: 'staged' as const, preparedFor: original?.preparedFor ?? state.inputKey,
      preparedAt: original?.preparedAt ?? state.updatedAt, context: original?.context ?? state.recentConversation ?? [], deliveryId };
  });
  const stagedIds = new Set(staged.map(card => card.id));
  const remaining = pending.filter(card => !stagedIds.has(card.id)).map(card => ({ ...card,
    status: card.status === 'ready' && !reusable.some(item => item.id === card.id) ? 'shelved' as const : card.status }));
  return { ...state, cards: selected, pending: [...remaining, ...staged].slice(-MAX_PENDING_RECALL_CARDS), candidates,
    deliveries: selected.length ? [...(state.deliveries ?? []), { id: deliveryId, inputKey: state.inputKey,
      status: 'staged' as const, timestamp: state.updatedAt, sources: selected.map(card => ({ id: card.id, revision: card.revision })) }].slice(-16)
      : state.deliveries, ...(error ? { error } : {}) };
}

/** Durable staging is a reservation; only a saved context reference proves actual consumption. */
export async function restoreRecallPending(state: RecallSessionState, sources: RecallSources, agentId: string,
  context: ContextMessage[]): Promise<RecallPending[]> {
  const included = new Set<string>();
  for (const message of context) if (message.origin === 'framework' && message.content.startsWith(RECALL_PREFIX)) {
    try {
      const payload: unknown = JSON.parse(message.content.slice(RECALL_PREFIX.length));
      if (recallObject(payload) && typeof payload.inputId === 'string') included.add(payload.inputId);
    } catch { /* An edited reference is not a delivery receipt. */ }
  }
  const pending: RecallPending[] = [];
  for (const item of state.pending ?? []) {
    const source = await sources.read(agentId, item.id);
    if (!source || source.revision !== item.revision) continue;
    const receipt = state.deliveries?.find(delivery => delivery.id === item.deliveryId);
    if (item.status === 'staged' || item.status === 'applied') pending.push({ ...item,
      status: receipt && included.has(receipt.inputKey) ? 'applied' : 'ready' });
    else pending.push(item);
  }
  return pending;
}
