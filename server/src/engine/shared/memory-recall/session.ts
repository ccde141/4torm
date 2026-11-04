import { randomUUID } from 'node:crypto';
import { isHumanContextMessage } from '../context-origin.js';
import { frameworkErrorFromUnknown } from '../framework-error.js';
import type { ContextMessage } from '../types.js';
import { loadMemoryRecallSettings, recallLevels, type MemoryRecallSettings } from './settings.js';
import { searchRecall } from './retrieval.js';
import { runRecallWorker } from './worker.js';
import { selectIndexedCards } from './cards.js';
import { selectRecallDelivery, RECALL_PREFIX, RECALL_NOTE, sanitizeRecallReferences } from './delivery.js';
import { hydrateRecallCandidates, recentRecallConversation, recallMessageText } from './context.js';
import { restoreRecallPending, reusableRecallPending, stageRecallCards } from './pending.js';
import { completeRecallIndex } from './vector-index.js';
import { recallHash } from './storage.js';
import { MAX_PENDING_RECALL_CARDS } from './budget.js';
import { needsReflection, reflectionSnapshot } from './reflection.js';
import { recallStateFile, loadRecallState, changeRecallState, invalidateRecallState } from './state.js';
import type { RecallCard, RecallPending, RecallScope, RecallSessionState, RecallSources } from './contracts.js';

const active = new Map<string, { controller: AbortController; job: Promise<unknown>; dataDir: string }>();
const running = new Set<{ controller: AbortController; job: Promise<unknown>; dataDir: string }>();
function configurationKey(settings: MemoryRecallSettings): string {
  const levels = recallLevels(settings);
  return recallHash(JSON.stringify(['light-reflection-v1', levels.level1Enabled, levels.level2Enabled,
    levels.level1Enabled ? settings.embeddingModel ?? null : null, levels.level2Enabled ? settings.model : null,
    settings.timing ?? 'after-send']));
}
export async function readRecallSessionState(dataDir: string, scope: RecallScope): Promise<RecallSessionState | null> {
  const state = await loadRecallState(dataDir, scope);
  return state?.status === 'searching' && !active.has(recallStateFile(dataDir, scope))
    ? changeRecallState(dataDir, scope, state.inputKey, current => current ? { ...current, status: 'cancelled', error: 'RECALL_INTERRUPTED' } : null) : state;
}
export async function retireRecallSession(dataDir: string, scope: RecallScope, deleted = false): Promise<void> {
  active.get(recallStateFile(dataDir, scope))?.controller.abort();
  await invalidateRecallState(dataDir, scope, deleted);
}
export function cancelRecallWorkers(dataDir: string): void {
  for (const job of running) if (job.dataDir === dataDir) job.controller.abort();
}
export async function drainRecallWorkers(dataDir: string): Promise<void> {
  cancelRecallWorkers(dataDir);
  await Promise.allSettled([...running].filter(job => job.dataDir === dataDir).map(job => job.job));
}

/** Current lookup precedes inference; independently checkpointed selection feeds later human inputs. */
export class MemoryRecallSession {
  private human?: ContextMessage;
  private generation = 0;
  private queued?: string;
  private readonly file: string;
  constructor(private readonly dataDir: string, private readonly scope: RecallScope,
    private readonly sources: RecallSources, private readonly worker = runRecallWorker) {
    this.file = recallStateFile(dataDir, scope);
  }

  async beforeModel(context: ContextMessage[], runId = '', control: {
    signal?: AbortSignal; onRecalling?: (active: boolean) => void;
  } = {}): Promise<{ messages: string[]; placement?: 'before-human'; commit(): Promise<void> }> {
    control.signal?.throwIfAborted();
    const empty = { messages: [] as string[], commit: async () => {} };
    await sanitizeRecallReferences(this.scope.agentId, this.sources, context);
    const human = [...context].reverse().find(isHumanContextMessage);
    if (!human || this.human === human) return empty;
    this.human = human;
    active.get(this.file)?.controller.abort();
    active.delete(this.file);
    const generation = ++this.generation;
    const settings = await loadMemoryRecallSettings(this.dataDir);
    const levels = recallLevels(settings);
    if (!levels.level1Enabled && !levels.level2Enabled) { this.queued = undefined; return empty; }
    const previousState = await readRecallSessionState(this.dataDir, this.scope);
    const sourceVersion = await this.sources.sessionVersion?.(this.scope.agentId, this.scope.sessionId);
    if (sourceVersion === null) return empty;
    const query = human.content.trim().slice(0, 1200);
    const configuration = configurationKey(settings);
    const compatible = previousState?.configuration === configuration && previousState.sourceVersion === sourceVersion;
    const pending = compatible ? await restoreRecallPending(previousState, this.sources, this.scope.agentId, context) : [];
    const skip = !query || /^(好[的吧]?|嗯+|谢谢[你]?|收到|ok)[。！？!?\s]*$/i.test(query);
    const state: RecallSessionState = { version: 2, owner: this.scope, sourceVersion: sourceVersion ?? undefined, configuration,
      inputKey: `${runId}:${randomUUID()}`, query, currentMessage: recallMessageText(human.content),
      recentConversation: recentRecallConversation(context), pending, deliveries: compatible ? previousState.deliveries ?? [] : [],
      reflection: compatible ? previousState.reflection : undefined,
      status: skip ? 'idle' : 'queued', updatedAt: new Date().toISOString(), cards: [] };
    this.queued = undefined;
    await this.save(generation, state, true);
    if (skip) return empty;
    const foreground = settings.timing === 'before-send' && levels.level2Enabled && !!settings.model;
    const cards = await this.track(signal => this.prepareInput(state, settings, context, generation, signal,
      foreground ? control.onRecalling : undefined), control.signal);
    control.signal?.throwIfAborted();
    const payload = cards.length ? RECALL_PREFIX + JSON.stringify({ inputId: state.inputKey,
      note: RECALL_NOTE, records: cards }) : '';
    return { messages: payload ? [payload] : [], placement: 'before-human', commit: async () => {
      await this.update(state.inputKey, current => ({ ...current,
        pending: current.pending?.map(card => card.status === 'staged' ? { ...card, status: 'applied' } : card),
        deliveries: current.deliveries?.map(item => item.inputKey === state.inputKey && item.status === 'staged' ? { ...item, status: 'applied' } : item) }));
      this.startPending();
      if (foreground && levels.level1Enabled && settings.embeddingModel) this.startIndex(state.inputKey, settings.embeddingModel);
    } };
  }

  private async prepareInput(state: RecallSessionState, settings: MemoryRecallSettings, context: ContextMessage[],
    generation: number, signal: AbortSignal, onRecalling?: (active: boolean) => void): Promise<RecallCard[]> {
    const levels = recallLevels(settings);
    await this.sources.sync(this.scope.agentId, signal);
    const indexed = await searchRecall(this.dataDir, this.scope.agentId, this.sources, { query: state.query, limit: 20 },
      { embeddingModel: levels.level1Enabled ? settings.embeddingModel : null, signal, indexMode: 'cached', timeoutMs: 1500, candidates: true });
    const fresh = levels.level1Enabled ? (await selectIndexedCards(this.scope.agentId, this.sources, indexed, signal)).cards : [];
    const reusable = reusableRecallPending(state.query, fresh, state.pending ?? []);
    const foreground = settings.timing === 'before-send' && levels.level2Enabled && !!settings.model;
    const reflection = reflectionSnapshot(state.query, context, indexed);
    const reflect = needsReflection(state.reflection, reflection);
    const candidates = reflect && levels.level2Enabled
      ? await hydrateRecallCandidates(this.scope.agentId, this.sources, indexed.records, signal, state.query) : [];
    let eligible: RecallCard[] = [...reusable, ...fresh], error = indexed.embeddingError, usage = state.usage;
    if (!reflect && levels.level2Enabled && state.reflection?.accepted) eligible = eligible.filter(card =>
      card.level === 'L2' || state.reflection!.accepted!.includes(`${card.id}:${card.revision}`));
    let workerFailed = false;
    if (foreground && reflect) {
      await this.save(generation, { ...state, status: 'searching', candidates });
      onRecalling?.(true);
      try {
        const result = await this.worker({ dataDir: this.dataDir, scope: this.scope, query: state.query,
          currentMessage: state.currentMessage, recentConversation: state.recentConversation,
          candidates, sources: this.sources, model: settings.model!,
          level1Candidates: fresh,
          embeddingModel: levels.level1Enabled ? settings.embeddingModel : null, signal });
        eligible = result.cards;
        usage = result.usage;
      } catch (failure) {
        workerFailed = true;
        signal.throwIfAborted();
        const detail = frameworkErrorFromUnknown(failure, 'memory-recall');
        error = detail.code === 'INTERNAL_ERROR' ? 'RECALL_SEARCH_FAILED' : detail.code;
        eligible = detail.kind === 'protocol' || detail.kind === 'conflict' ? [] : fresh;
      } finally { onRecalling?.(false); }
    }
    const matched = new Set(eligible.map(card => `${card.id}:${card.revision}`));
    const delivery = await selectRecallDelivery(this.scope.agentId, this.sources, state.query, context, eligible, signal, matched);
    const selected = delivery.cards;
    if (configurationKey(await loadMemoryRecallSettings(this.dataDir)) !== state.configuration) return [];
    const selection: NonNullable<RecallSessionState['selection']> = {
      reason: workerFailed ? 'failed' : selected.length ? 'injected' : delivery.duplicateCount ? 'already-present' : eligible.length ? 'filtered' : 'no-match',
      candidateCount: candidates.length, selectedCount: eligible.length, attachedCount: selected.length,
      duplicateCount: delivery.duplicateCount, unavailableCount: delivery.unavailableCount };
    const next = stageRecallCards({ ...state, ...(usage ? { usage } : {}), selection,
      status: foreground ? workerFailed ? 'failed' : selected.length ? 'ready' : 'empty' : state.status },
      selected, reusable, candidates, error);
    if (foreground && reflect && !workerFailed) next.reflection = { ...reflection, accepted: eligible.map(card => `${card.id}:${card.revision}`) };
    if (!foreground && reflect) next.pendingReflection = reflection;
    signal.throwIfAborted();
    if (!await this.save(generation, next)) return [];
    if (!foreground && reflect) this.queued = next.inputKey;
    return selected;
  }

  /** Start once input checkpointing commits; a newer input cancels older work. */
  startPending(): void {
    const inputKey = this.queued;
    if (!inputKey || active.has(this.file)) return;
    this.queued = undefined;
    const generation = this.generation;
    void this.track(async signal => {
      const state = await loadRecallState(this.dataDir, this.scope);
      if (state?.inputKey === inputKey) await this.search(state, generation, signal);
    }).catch(error => {
      console.warn('[memory-recall]', error instanceof Error ? error.message : 'RECALL_STATE_WRITE_FAILED');
    });
  }

  private startIndex(inputKey: string, model: string): void {
    if (active.has(this.file)) return;
    void this.track(async signal => {
      const state = await loadRecallState(this.dataDir, this.scope);
      if (state?.inputKey !== inputKey) return;
      await completeRecallIndex(this.dataDir, this.scope.agentId, await this.sources.list(this.scope.agentId), model, signal);
    }).catch(error => {
      if (!(error instanceof Error && error.name === 'AbortError')) console.warn('[memory-recall] EMBEDDING_INDEX_INCOMPLETE');
    });
  }

  private track<T>(task: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(parent?.reason);
    parent?.addEventListener('abort', abort, { once: true });
    if (parent?.aborted) abort();
    const job = { controller, dataDir: this.dataDir, job: Promise.resolve() as Promise<unknown> };
    active.set(this.file, job); running.add(job);
    const result = task(controller.signal).finally(() => {
      parent?.removeEventListener('abort', abort);
      running.delete(job); if (active.get(this.file) === job) active.delete(this.file);
    });
    job.job = result;
    return result;
  }

  private async search(state: RecallSessionState, generation: number, signal: AbortSignal): Promise<void> {
    try {
      const settings = await loadMemoryRecallSettings(this.dataDir);
      const levels = recallLevels(settings);
      if (!levels.level1Enabled && !levels.level2Enabled) return;
      await this.save(generation, { ...state, status: 'searching' });
      await this.sources.sync(this.scope.agentId, signal);
      signal.throwIfAborted();
      const embeddingModel = levels.level1Enabled ? settings.embeddingModel : null;
      const result = state.candidates ? { records: state.candidates, scores: {}, embeddingError: undefined }
        : await searchRecall(this.dataDir, this.scope.agentId, this.sources, { query: state.query, limit: 20 }, { embeddingModel, signal, candidates: true });
      const candidates = await hydrateRecallCandidates(this.scope.agentId, this.sources, result.records, signal, state.query);
      const selected = levels.level2Enabled && settings.model
        ? await this.worker({ dataDir: this.dataDir, scope: this.scope, query: state.query,
          currentMessage: state.currentMessage, recentConversation: state.recentConversation,
          candidates, sources: this.sources, model: settings.model, embeddingModel, signal,
          level1Candidates: state.cards.filter(card => card.level === 'L1') })
        : { cards: state.cards.filter(card => card.level === 'L1') };
      signal.throwIfAborted();
      const current = await loadMemoryRecallSettings(this.dataDir);
      if (configurationKey(current) !== state.configuration) return;
      await this.update(state.inputKey, current => {
        const fresh: RecallPending[] = selected.cards.map(card => ({ ...card, status: 'ready', preparedFor: state.inputKey,
          preparedAt: new Date().toISOString(), context: [...(state.recentConversation ?? []), { role: 'user' as const, content: state.currentMessage ?? state.query }].slice(-6) }));
        const ids = new Set(fresh.map(card => card.id));
        return { ...current, ...selected, status: fresh.length ? 'ready' : 'empty',
          reflection: current.pendingReflection ? { ...current.pendingReflection, accepted: selected.cards.map(card => `${card.id}:${card.revision}`) } : current.reflection,
          pendingReflection: undefined,
          selection: { reason: fresh.length ? 'prepared' : 'no-match', candidateCount: candidates.length,
            selectedCount: fresh.length, attachedCount: 0, duplicateCount: 0, unavailableCount: 0 },
          pending: [...(current.pending ?? []).filter(card => !ids.has(card.id)).map(card =>
            card.status === 'ready' ? { ...card, status: 'shelved' as const } : card), ...fresh].slice(-MAX_PENDING_RECALL_CARDS), candidates: [],
          ...(result.embeddingError ? { error: result.embeddingError } : {}) };
      });
      // Indexing is resumable derived work. Cancelling it must not discard the already prepared cards.
      if (embeddingModel) {
        try { await completeRecallIndex(this.dataDir, this.scope.agentId, await this.sources.list(this.scope.agentId), embeddingModel, signal); }
        catch (error) {
          if (!signal.aborted) console.warn('[memory-recall] EMBEDDING_INDEX_INCOMPLETE',
            error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'EMBEDDING_INDEX_FAILED');
        }
      }
    } catch (error) {
      const failure = frameworkErrorFromUnknown(error, 'memory-recall');
      await this.update(state.inputKey, current => ({ ...current, status: signal.aborted ? 'cancelled' : 'failed',
        selection: signal.aborted ? undefined : { reason: 'failed', candidateCount: state.candidates?.length ?? 0,
          selectedCount: 0, attachedCount: 0, duplicateCount: 0, unavailableCount: 0 },
        error: failure.code !== 'INTERNAL_ERROR' ? failure.code
          : error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'RECALL_SEARCH_FAILED' }));
    }
  }

  private save(generation: number, state: RecallSessionState, claim = false): Promise<boolean> {
    if (generation !== this.generation) return Promise.resolve(false);
    return this.write(claim ? undefined : state.inputKey, () => state).then(Boolean);
  }
  private update(inputKey: string, change: (current: RecallSessionState) => RecallSessionState) {
    return this.write(inputKey, current => current ? change(current) : null);
  }
  private async write(expected: string | undefined, change: (current: RecallSessionState | null) => RecallSessionState | null) {
    const version = await this.sources.sessionVersion?.(this.scope.agentId, this.scope.sessionId);
    if (version === null) return null;
    return changeRecallState(this.dataDir, this.scope, expected, current => {
      const next = change(current);
      return next && next.sourceVersion === version ? next : null;
    });
  }
}
