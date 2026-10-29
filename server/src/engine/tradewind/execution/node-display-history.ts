import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWriteFile } from '../../shared/atomic-io.js';
import type { ContextMessage } from '../../shared/types.js';
import { projectNodeHistory, type NodeHistoryMessage } from './node-history-view.js';

interface DisplayCheckpoint { contextLength: number; contextHash: string; commitId?: string; messages: NodeHistoryMessage[] }
interface DisplayJournal { version: 1; previous?: DisplayCheckpoint; pending: DisplayCheckpoint }

/** Human history has an independent cursor; compressed model records never replace it. */
export class NodeDisplayHistory {
  private checkpoint?: DisplayCheckpoint;
  constructor(private readonly directory?: string,
    private readonly project: (messages: readonly ContextMessage[]) => NodeHistoryMessage[] = projectNodeHistory) {}

  messages(context: readonly ContextMessage[]): NodeHistoryMessage[] {
    return [...(this.checkpoint?.messages ?? []),
      ...this.project(context.slice(this.checkpoint?.contextLength ?? 1))];
  }

  async stage(before: readonly ContextMessage[], next: ContextMessage[],
    compaction: { id: string; summary: string }, signal?: AbortSignal): Promise<() => void> {
    if (!this.checkpoint && this.directory) this.checkpoint = await readCheckpoint(this.directory, before);
    if (this.checkpoint && !matches(this.checkpoint, before)) throw new Error('节点展示履历与当前上下文不一致');
    if (!next[1]) throw new Error('压缩上下文缺少交接记录');
    const commitId = randomUUID();
    // Local commit identity travels with the actual model checkpoint, outside provider fields.
    next[1] = { ...next[1], nodeCompactionId: commitId } as ContextMessage & { nodeCompactionId: string };
    const pending: DisplayCheckpoint = { contextLength: next.length, commitId, contextHash: contextHash(next, next.length),
      messages: [...this.messages(before), { role: 'system', content: `[历史压缩记录]\n${compaction.summary}`, compaction }] };
    if (this.directory) {
      await fs.mkdir(this.directory, { recursive: true });
      await atomicWriteFile(path.join(this.directory, 'display-history.json'),
        JSON.stringify({ version: 1, previous: this.checkpoint, pending } satisfies DisplayJournal), signal);
    }
    return () => { this.checkpoint = pending; };
  }
}

/** A prepared display draft becomes visible only after its matching model checkpoint commits. */
export async function readNodeDisplayHistory(directory: string,
  context: readonly ContextMessage[]): Promise<NodeHistoryMessage[]> {
  const selected = await readCheckpoint(directory, context);
  return selected ? [...selected.messages, ...projectNodeHistory(context.slice(selected.contextLength))]
    : projectNodeHistory(context.slice(1));
}

async function readCheckpoint(directory: string, context: readonly ContextMessage[]): Promise<DisplayCheckpoint | undefined> {
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(path.join(directory, 'display-history.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  if (!record(value) || value.version !== 1) throw new Error('节点展示履历无效');
  const pending = checkpoint(value.pending);
  const previous = value.previous === undefined ? undefined : checkpoint(value.previous);
  return [pending, previous].find(item => item && matches(item, context));
}

function matches(item: DisplayCheckpoint, context: readonly ContextMessage[]): boolean {
  return (!item.commitId || (context[1] as (ContextMessage & { nodeCompactionId?: string }) | undefined)?.nodeCompactionId === item.commitId)
    && item.contextLength <= context.length && item.contextHash === contextHash(context, item.contextLength);
}

function contextHash(context: readonly ContextMessage[], length: number): string {
  // The current identity prompt can change between rounds; it is never display history.
  return createHash('sha256').update(JSON.stringify(context.slice(1, length))).digest('hex');
}
function checkpoint(value: unknown): DisplayCheckpoint {
  if (!record(value) || !Number.isSafeInteger(value.contextLength) || Number(value.contextLength) < 1
    || typeof value.contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contextHash)
    || (value.commitId !== undefined && (typeof value.commitId !== 'string' || !value.commitId))
    || !Array.isArray(value.messages) || !value.messages.every(message => record(message)
      && ['user', 'assistant', 'system'].includes(String(message.role)) && typeof message.content === 'string')) {
    throw new Error('节点展示履历无效');
  }
  return value as unknown as DisplayCheckpoint;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
