import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { recallDirectory, recallHash, recallObject, readRecallJson, writeRecallJson, withRecallLock } from './storage.js';
import type { RecallCard, RecallScope, RecallSessionState } from './contracts.js';
import { MAX_RECALL_CARDS, MAX_PENDING_RECALL_CARDS, MAX_RECALL_TEXT_LENGTH } from './budget.js';

export function recallStateFile(dataDir: string, scope: RecallScope): string {
  return path.join(recallDirectory(dataDir, scope.agentId), 'sessions', `${recallHash(scope.sessionId)}.json`);
}
function card(value: unknown): value is RecallCard {
  return recallObject(value) && ['id', 'revision', 'text', 'title', 'kind'].every(key => typeof value[key] === 'string')
    && ['L1', 'L2'].includes(String(value.level)) && ['memory', 'work'].includes(String(value.kind))
    && String(value.text).length <= MAX_RECALL_TEXT_LENGTH
    && (value.relevance === undefined || typeof value.relevance === 'string' && value.relevance.length <= 600);
}
function conversation(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 20 && value.every(message => recallObject(message)
    && ['user', 'assistant'].includes(String(message.role)) && typeof message.content === 'string' && message.content.length <= 4000);
}
function reflection(value: unknown): boolean {
  return value === undefined || recallObject(value) && typeof value.query === 'string' && typeof value.compact === 'string'
    && Array.isArray(value.candidates) && value.candidates.length <= 5 && value.candidates.every(id => typeof id === 'string')
    && (value.accepted === undefined || Array.isArray(value.accepted) && value.accepted.length <= MAX_RECALL_CARDS && value.accepted.every(id => typeof id === 'string'))
    && (value.vector === undefined || Array.isArray(value.vector) && value.vector.length <= 8192
      && value.vector.every(n => typeof n === 'number' && Number.isFinite(n)));
}
function valid(value: unknown): value is RecallSessionState {
  if (!recallObject(value) || (value.version !== 1 && value.version !== 2) || typeof value.inputKey !== 'string'
    || typeof value.query !== 'string' || typeof value.updatedAt !== 'string'
    || !['idle', 'queued', 'searching', 'ready', 'empty', 'cancelled', 'failed'].includes(String(value.status))
    || !Array.isArray(value.cards) || value.cards.length > MAX_RECALL_CARDS || !value.cards.every(card)) return false;
  const selection = value.selection;
  if (selection !== undefined && (!recallObject(selection)
    || !['injected', 'already-present', 'no-match', 'filtered', 'failed', 'prepared'].includes(String(selection.reason))
    || !['candidateCount', 'selectedCount', 'attachedCount', 'duplicateCount', 'unavailableCount']
      .every(key => Number.isSafeInteger(selection[key]) && Number(selection[key]) >= 0))) return false;
  if (value.version === 1) return true;
  if (!reflection(value.reflection) || !reflection(value.pendingReflection)) return false;
  return recallObject(value.owner) && typeof value.owner.agentId === 'string' && typeof value.owner.sessionId === 'string'
    && Array.isArray(value.pending) && value.pending.length <= MAX_PENDING_RECALL_CARDS && value.pending.every(item => card(item) && recallObject(item)
      && typeof item.preparedFor === 'string' && typeof item.preparedAt === 'string' && Array.isArray(item.context)
      && conversation(item.context)
      && ['ready', 'shelved', 'staged', 'applied'].includes(String(item.status)))
    && Array.isArray(value.deliveries) && value.deliveries.length <= 16 && value.deliveries.every(item => recallObject(item)
      && typeof item.id === 'string' && typeof item.inputKey === 'string' && ['staged', 'applied', 'invalidated'].includes(String(item.status))
      && Array.isArray(item.sources) && item.sources.length <= MAX_RECALL_CARDS && item.sources.every(source => recallObject(source)
        && typeof source.id === 'string' && typeof source.revision === 'string'))
    && (value.recentConversation === undefined || conversation(value.recentConversation))
    && (value.currentMessage === undefined || typeof value.currentMessage === 'string' && value.currentMessage.length <= 4000)
    && (value.sourceVersion === undefined || typeof value.sourceVersion === 'string')
    && (value.candidates === undefined || Array.isArray(value.candidates) && value.candidates.length <= 20
      && value.candidates.every(item => recallObject(item) && typeof item.id === 'string' && typeof item.revision === 'string'
        && (item.excerpt === undefined || typeof item.excerpt === 'string' && item.excerpt.length <= 400)
        && (item.excerptOffset === undefined || Number.isSafeInteger(item.excerptOffset) && Number(item.excerptOffset) >= 0)));
}

export async function loadRecallState(dataDir: string, scope: RecallScope): Promise<RecallSessionState | null> {
  const value = await readRecallJson(recallStateFile(dataDir, scope), valid);
  if (!value) return null;
  if (value.owner && (value.owner.agentId !== scope.agentId || value.owner.sessionId !== scope.sessionId)) throw Error('RECALL_OWNER_MISMATCH');
  if (value.version === 2) return value;
  return { ...value, version: 2, owner: scope, deliveries: [], pending: value.cards.map(item => ({ ...item,
    status: 'ready', preparedFor: value.inputKey, preparedAt: value.updatedAt, context: [] })) };
}

/** All durable transitions share one file lock and reject superseded input identities. */
export function changeRecallState(dataDir: string, scope: RecallScope, expected: string | undefined,
  change: (current: RecallSessionState | null) => RecallSessionState | null): Promise<RecallSessionState | null> {
  return withRecallLock(recallStateFile(dataDir, scope), async () => {
    const current = await loadRecallState(dataDir, scope);
    if (expected !== undefined && current?.inputKey !== expected) return null;
    const next = change(current);
    if (!next) return null;
    next.updatedAt = new Date().toISOString();
    if (!valid(next)) throw Error('RECALL_STATE_INVALID');
    await writeRecallJson(recallStateFile(dataDir, scope), next);
    return next;
  });
}

/** Called by the owner after an authorized history mutation or session deletion. */
export async function invalidateRecallState(dataDir: string, scope: RecallScope, deleted = false): Promise<void> {
  if (deleted) {
    await withRecallLock(recallStateFile(dataDir, scope), () => fs.rm(recallStateFile(dataDir, scope), { force: true }));
    return;
  }
  await changeRecallState(dataDir, scope, undefined, current => current ? { ...current,
    inputKey: randomUUID(), status: 'cancelled', cards: [], pending: [], candidates: [], recentConversation: [], currentMessage: '',
    reflection: undefined, pendingReflection: undefined,
    selection: undefined,
    deliveries: (current.deliveries ?? []).map(item => ({ ...item, status: 'invalidated' })) } : null);
}
