import { createRecallCatalog, MemoryRecallSession, executeRecallTool, RECALL_TOOL_NAMES,
  loadMemoryRecallSettings, type RecallSources } from '../../../engine/shared/memory-recall/index.js';
import type { ContextMessage } from '../../../engine/shared/types.js';
import type { MonsoonEvent, MonsoonTurn, MonsoonTurnSpec } from './turn-contract.js';
import { FileMonsoonSessionRepository } from '../infrastructure/session-repository.js';
import { syncMonsoonRecallRecords } from '../infrastructure/recall-records.js';
import { projectMonsoonContext } from '../application/active-context.js';
import { sessionSourceVersion } from '../domain/session.js';
import { recallSourceMessages, recallWorkInput } from '../application/recall-source.js';

export function monsoonRecallSources(dataDir: string): RecallSources {
  const base = createRecallCatalog(dataDir, (agentId, signal) => syncMonsoonRecallRecords(dataDir, agentId, signal));
  const sessions = new FileMonsoonSessionRepository(dataDir);
  return { ...base, list: async agentId => {
    const records = await base.list(agentId);
    const live = new Set((await sessions.listMetadata(agentId)).map(session => session.id));
    // Candidate discovery reads session metadata; selected sources still verify their actual compact marker below.
    return records.filter(record => record.kind === 'memory' || !!(record.sessionId && live.has(record.sessionId)));
  }, sessionVersion: async (agentId, sessionId) => {
    const session = await sessions.get(agentId, sessionId);
    return session ? sessionSourceVersion(session) : null;
  }, readOriginal: async (agentId, id, offset, limit) => {
    const document = await readCurrent(agentId, id);
    const session = document?.sessionId ? await sessions.get(agentId, document.sessionId) : null;
    const end = session?.messages.findIndex(message => message.id === document?.sourceId && message.type === 'compact-marker') ?? -1;
    if (!session || end < 0) return null;
    let total = 0;
    const selected: string[] = [];
    for (const message of recallSourceMessages(session, end)) {
      if (message.type === 'compact-marker') continue;
      for (const item of projectMonsoonContext({ messages: [message] })) {
        if (item.role === 'system') continue;
        const text = `${item.role}: ${item.content}${item.toolCalls ? `\n${JSON.stringify(item.toolCalls)}` : ''}\n`;
        const from = Math.max(0, offset - total), to = Math.min(text.length, offset + limit - total);
        if (to > from) selected.push(text.slice(from, to));
        total += text.length;
      }
    }
    return { content: selected.join(''), total };
  }, read: readCurrent };

  async function readCurrent(agentId: string, id: string) {
    const document = await base.read(agentId, id);
    if (document?.kind === 'work') {
      const session = document.sessionId ? await sessions.get(agentId, document.sessionId) : null;
      const index = session?.messages.findIndex(message => message.id === document.sourceId && message.type === 'compact-marker') ?? -1;
      if (!session || index < 0 || document.sourceRevision !== sessionSourceVersion(session) || document.sessionTitle !== session.title) return null;
      if (recallWorkInput(session, index).summary !== document.content) return null;
    }
    return document;
  }
}
export class MonsoonRecallAdapter {
  private readonly sources: RecallSources;
  private readonly session: MemoryRecallSession;
  private emit?: (event: MonsoonEvent) => void;
  constructor(private readonly spec: MonsoonTurnSpec, private readonly runId: () => string | undefined) {
    this.sources = monsoonRecallSources(spec.dataDir);
    this.session = new MemoryRecallSession(spec.dataDir, spec, this.sources);
  }
  async beforeModel(context: ContextMessage[], signal?: AbortSignal) {
    try { return await this.session.beforeModel(context, this.runId(), { signal, onRecalling: active => {
      if (!signal?.aborted) this.emit?.({ type: 'heartbeat', phase: active ? 'memory-recalling' : 'llm-waiting', elapsed: 0 });
    } }); }
    catch { signal?.throwIfAborted(); console.warn('[memory-recall] RECALL_PREPARATION_FAILED'); return { messages: [], commit: async () => {} }; }
  }
  handles(name: string): boolean { return RECALL_TOOL_NAMES.includes(name as typeof RECALL_TOOL_NAMES[number]); }
  async call(name: string, args: Record<string, string>, signal?: AbortSignal): Promise<string> {
    await this.sources.sync(this.spec.agentId, signal);
    const settings = await loadMemoryRecallSettings(this.spec.dataDir);
    return executeRecallTool(this.spec.dataDir, this.spec.agentId, this.sources, name, args,
      { embeddingModel: settings.embeddingModel, signal });
  }
  wrap(turn: MonsoonTurn): MonsoonTurn {
    return { ...turn,
      chat: async (...args) => {
        this.emit = args[2];
        const result = await turn.chat(...args);
        if (result.content.trim() && !turn.isSuspended()) this.session.startPending();
        return result;
      },
      resume: async (...args) => {
        this.emit = args[1];
        const result = await turn.resume(...args);
        if (result.content.trim() && !turn.isSuspended()) this.session.startPending();
        return result;
      },
    };
  }
}
