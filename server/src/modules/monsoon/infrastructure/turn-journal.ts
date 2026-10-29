import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { agentSessionsDir } from '../../../services/data-paths.js';
import type { MonsoonMessage } from '../domain/session.js';

interface JournalHeader {
  schemaVersion: 1;
  agentId: string;
  sessionId: string;
  runId: string;
  baseMessageRevision: number;
  startedAt: string;
}

export interface PendingMonsoonRun {
  runId: string;
  events: Array<Record<string, unknown> & { type: string }>;
  truncated: boolean;
}

export interface MonsoonJournalWriter {
  readonly file: string;
  append(event: unknown): Promise<void>;
}

export class FileMonsoonTurnJournal {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly dataDir: string) {}

  async begin(
    agentId: string,
    sessionId: string,
    runId: string,
    baseMessageRevision: number,
  ): Promise<MonsoonJournalWriter> {
    identifier(agentId); identifier(sessionId); identifier(runId);
    const directory = this.directory(agentId, sessionId);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, `${runId}.ndjson`);
    const header: JournalHeader = {
      schemaVersion: 1, agentId, sessionId, runId, baseMessageRevision,
      startedAt: new Date().toISOString(),
    };
    await atomicWriteFile(file, `${JSON.stringify(header)}\n`);
    return { file, append: event => this.append(file, event) };
  }

  async pending(
    agentId: string,
    sessionId: string,
    messages: readonly MonsoonMessage[],
    cleanup = true,
  ): Promise<PendingMonsoonRun[]> {
    const directory = this.directory(agentId, sessionId);
    const result: PendingMonsoonRun[] = [];
    for (const file of await journalFiles(directory)) {
      const parsed = await readJournal(file);
      if (isAbsorbed(messages, parsed.header.runId, parsed.events)) {
        if (cleanup) await fs.rm(file, { force: true });
        continue;
      }
      result.push({ runId: parsed.header.runId,
        events: foldReplayText(restoreCommittedCompactions(parsed.header.runId, parsed.events, messages)),
        truncated: parsed.truncated });
    }
    if (cleanup) await removeEmpty(directory);
    return result;
  }

  async hasUnabsorbed(
    agentId: string, sessionId: string, messages: readonly MonsoonMessage[],
  ): Promise<boolean> {
    for (const file of await journalFiles(this.directory(agentId, sessionId))) {
      const { header, events } = await readJournal(file);
      if (!isAbsorbed(messages, header.runId, events)) return true;
    }
    return false;
  }

  private append(file: string, event: unknown): Promise<void> {
    const parsed = journalEvent(event);
    const prior = this.queues.get(file) ?? Promise.resolve();
    const next = prior.then(() => fs.appendFile(file, `${JSON.stringify(parsed)}\n`, 'utf8'));
    this.queues.set(file, next);
    return next.finally(() => { if (this.queues.get(file) === next) this.queues.delete(file); });
  }

  private directory(agentId: string, sessionId: string): string {
    identifier(agentId); identifier(sessionId);
    return path.join(agentSessionsDir(this.dataDir, agentId), `${sessionId}.runs`);
  }
}

/** The session commit precedes its stream event; restore only that known crash window. */
function restoreCommittedCompactions(runId: string, events: PendingMonsoonRun['events'],
  messages: readonly MonsoonMessage[]): PendingMonsoonRun['events'] {
  const assistantIds = new Set(messages.filter(message => message.role === 'assistant'
    && (message.id === runId || message.inputRunId === runId)).map(message => message.id));
  const recorded = new Set(events.filter(event => event.type === 'context-compacted')
    .flatMap(event => record(event.marker) && typeof event.marker.id === 'string' ? [event.marker.id] : []));
  const missing = messages.filter(message => message.type === 'compact-marker'
    && record(message.execution) && assistantIds.has(String(message.execution.assistantId))
    && Number.isSafeInteger(message.execution.eventOffset) && Number(message.execution.eventOffset) >= 0
    && Number.isSafeInteger(message.committedRevision) && !recorded.has(message.id));
  if (!missing.length) return events;
  const restored = [...events];
  const prefix = events.findIndex(event => event.type !== 'reply-accepted');
  for (const marker of missing.sort((a, b) => Number((a.execution as Record<string, unknown>).eventOffset)
    - Number((b.execution as Record<string, unknown>).eventOffset))) {
    const offset = Number((marker.execution as Record<string, unknown>).eventOffset) + Math.max(0, prefix);
    restored.splice(Math.min(offset, restored.length), 0,
      { type: 'context-compacted', revision: marker.committedRevision, marker });
  }
  return restored;
}

async function journalFiles(directory: string): Promise<string[]> {
  try {
    return (await fs.readdir(directory)).filter(file => file.endsWith('.ndjson'))
      .sort().map(file => path.join(directory, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function isAbsorbed(
  messages: readonly MonsoonMessage[], runId: string,
  events: ReadonlyArray<{ type: string }>,
): boolean {
  const legacyComplete = events.some(event => event.type === 'done')
    && !events.some(event => event.type === 'error');
  return messages.some(message => message.role === 'assistant' && message.id === runId
    && (message.runCommitted === true || (message.runCommitted === undefined
      && legacyComplete && message.streamingPhase === undefined
      && message.content.trim().length > 0)));
}

async function readJournal(file: string): Promise<{
  header: JournalHeader;
  events: Array<Record<string, unknown> & { type: string }>;
  truncated: boolean;
}> {
  const raw = await fs.readFile(file, 'utf8');
  const lines = raw.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const header = journalHeader(parse(lines.shift(), '运行日志头损坏'));
  const events: Array<Record<string, unknown> & { type: string }> = [];
  let truncated = false;
  for (let index = 0; index < lines.length; index++) {
    try { events.push(journalEvent(JSON.parse(lines[index]!))); }
    catch (error) {
      if (index !== lines.length - 1) throw error;
      truncated = true;
    }
  }
  return { header, events, truncated };
}

function journalHeader(value: unknown): JournalHeader {
  if (!record(value) || value.schemaVersion !== 1 || !Number.isInteger(value.baseMessageRevision)) {
    throw new Error('运行日志头损坏');
  }
  identifier(value.agentId); identifier(value.sessionId); identifier(value.runId);
  if (typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))) {
    throw new Error('运行日志头损坏');
  }
  return value as unknown as JournalHeader;
}

function journalEvent(value: unknown): Record<string, unknown> & { type: string } {
  if (!record(value) || typeof value.type !== 'string' || !value.type) throw new Error('运行事件无效');
  return structuredClone(value) as Record<string, unknown> & { type: string };
}

/** Fold only adjacent plain text chunks; keep the durable journal and other event boundaries intact. */
function foldReplayText(events: PendingMonsoonRun['events']): PendingMonsoonRun['events'] {
  const result: PendingMonsoonRun['events'] = [];
  let kind = '';
  let chunks: string[] = [];
  const flush = () => {
    if (chunks.length) result.push({ type: kind, content: chunks.join('') });
    kind = ''; chunks = [];
  };
  for (const event of events) {
    const plainText = (event.type === 'token' || event.type === 'reasoning')
      && typeof event.content === 'string' && Object.keys(event).length === 2;
    if (!plainText) { flush(); result.push(event); continue; }
    if (kind !== event.type) flush();
    kind = event.type;
    chunks.push(event.content as string);
  }
  flush();
  return result;
}

function parse(value: string | undefined, message: string): unknown {
  try { return JSON.parse(value ?? ''); }
  catch { throw new Error(message); }
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value)) {
    throw new Error('运行日志标识无效');
  }
}

async function removeEmpty(directory: string): Promise<void> {
  try { await fs.rmdir(directory); }
  catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
