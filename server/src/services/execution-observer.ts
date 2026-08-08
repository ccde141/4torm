import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../engine/shared/atomic-io.js';
import { readJsonFile } from './json-file-store.js';
import type {
  ObservationKind,
  ObservationScope,
  ObservationStatus,
  ObservationStream,
  ObservationTerminalStatus,
  ObservationViewer,
  VisualObservationState,
} from './execution-observation-contract.js';

export type {
  ObservationKind,
  ObservationScope,
  ObservationStatus,
  ObservationStream,
  ObservationTerminalStatus,
  ObservationViewer,
  VisualObservationState,
} from './execution-observation-contract.js';

export const OBSERVATION_PROMOTION_MS = 5_000;
const MAX_OUTPUT_CHARS = 60_000;

export interface ExecutionObservation {
  id: string;
  scope: ObservationScope;
  ownerId: string;
  surfaceId?: string;
  kind: ObservationKind;
  viewer: ObservationViewer;
  command: string;
  startedAt: number;
  finishedAt?: number;
  status: ObservationStatus;
  exitCode?: number;
  error?: string;
  progress?: string;
  outputTruncated?: boolean;
  /** 已明确脱离调用方的终端任务立即进入任务板，不再等待时间门槛。 */
  promoted?: boolean;
  output: Array<{ stream: ObservationStream; text: string }>;
  viewerState?: VisualObservationState;
}

export interface ObservationStart {
  scope: ObservationScope;
  ownerId: string;
  surfaceId?: string;
  command: string;
  kind?: ObservationKind;
  viewer?: ObservationViewer;
}

export interface ObservationFinish {
  status: ObservationTerminalStatus;
  exitCode?: number;
  error?: string;
}

export class ExecutionObserver {
  private readonly entries = new Map<string, ExecutionObservation>();
  private persistenceFile?: string;
  private persistTimer?: NodeJS.Timeout;

  constructor(private readonly now: () => number = Date.now) {}

  start(input: ObservationStart): ExecutionObservation {
    const entry: ExecutionObservation = {
      id: randomUUID(),
      scope: input.scope,
      ownerId: input.ownerId,
      surfaceId: input.surfaceId,
      kind: input.kind ?? 'terminal',
      viewer: input.viewer ?? input.kind ?? 'terminal',
      command: input.command,
      startedAt: this.now(),
      status: 'running',
      output: [],
    };
    this.entries.set(entry.id, entry);
    this.schedulePersist();
    return entry;
  }

  append(id: string, stream: ObservationStream, text: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== 'running' || !text) return;
    entry.output.push({ stream, text });
    this.trimOutput(entry);
    entry.progress = latestOutputLine(entry.output);
    this.schedulePersist();
  }

  requestCancellation(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || !isActive(entry.status) || entry.status === 'cancelling') return false;
    entry.status = 'cancelling';
    this.schedulePersist(true);
    return true;
  }

  promote(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.promoted) return false;
    entry.promoted = true;
    this.schedulePersist(true);
    return true;
  }

  finish(id: string, input: ObservationFinish): void {
    const entry = this.entries.get(id);
    if (!entry || !isActive(entry.status)) return;
    entry.status = input.status;
    entry.finishedAt = this.now();
    if (input.exitCode !== undefined) entry.exitCode = input.exitCode;
    if (input.error) entry.error = input.error;
    this.schedulePersist(true);
  }

  updateViewer(id: string, viewerState: VisualObservationState): void {
    const entry = this.entries.get(id);
    if (!entry || entry.viewer === 'terminal' || !isActive(entry.status)) return;
    entry.viewerState = viewerState;
    entry.status = viewerState.control === 'human' ? 'waiting' : 'running';
    this.schedulePersist();
  }

  listActive(scope: ObservationScope, ownerId: string): ExecutionObservation[] {
    return [...this.entries.values()]
      .filter(entry => entry.scope === scope && entry.ownerId === ownerId && isActive(entry.status))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  list(scope: ObservationScope, ownerId: string): ExecutionObservation[] {
    return [...this.entries.values()]
      .filter(entry => entry.scope === scope && entry.ownerId === ownerId && (isActive(entry.status) && entry.viewer !== 'terminal' || this.isPromoted(entry)))
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 12);
  }

  get(id: string): ExecutionObservation | undefined {
    return this.entries.get(id);
  }

  getForOwner(id: string, scope: ObservationScope, ownerId: string): ExecutionObservation | undefined {
    const entry = this.entries.get(id);
    const visible = entry && (entry.viewer !== 'terminal' && isActive(entry.status) || this.isPromoted(entry));
    if (!entry || entry.scope !== scope || entry.ownerId !== ownerId || !visible) return undefined;
    return entry;
  }

  async restore(file: string): Promise<number> {
    this.persistenceFile = file;
    const raw = await readEntries(file);
    const now = this.now();
    let crashed = 0;
    for (const entry of raw) {
      if (!isObservation(entry)) continue;
      entry.kind ??= 'terminal';
      entry.viewer ??= 'terminal';
      if (isActive(entry.status)) {
        entry.status = 'crashed';
        entry.finishedAt = now;
        entry.error = '应用重启，执行状态未知';
        crashed++;
      }
      this.entries.set(entry.id, entry);
    }
    if (crashed) await this.persist();
    return crashed;
  }

  async flush(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    await this.persist();
  }

  private schedulePersist(immediate = false): void {
    if (!this.persistenceFile) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist().catch(error => console.error('[execution-observer] persist failed:', error));
    }, immediate ? 0 : 250);
  }

  private async persist(): Promise<void> {
    if (!this.persistenceFile) return;
    await fs.mkdir(path.dirname(this.persistenceFile), { recursive: true });
    await atomicWriteFile(this.persistenceFile, JSON.stringify(
      [...this.entries.values()].filter(entry => isActive(entry.status) || this.isPromoted(entry)).slice(-120),
    ));
  }

  private isPromoted(entry: ExecutionObservation): boolean {
    if (entry.promoted) return true;
    const endedAt = entry.finishedAt ?? this.now();
    return endedAt - entry.startedAt >= OBSERVATION_PROMOTION_MS;
  }

  private trimOutput(entry: ExecutionObservation): void {
    let total = entry.output.reduce((sum, chunk) => sum + chunk.text.length, 0);
    while (total > MAX_OUTPUT_CHARS && entry.output.length > 1) {
      total -= entry.output.shift()!.text.length;
      entry.outputTruncated = true;
    }
  }
}

async function readEntries(file: string): Promise<unknown[]> {
  return (await readJsonFile<unknown[]>(file, 'execution-observer')) ?? [];
}

function isObservation(value: unknown): value is ExecutionObservation {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ExecutionObservation>;
  return typeof entry.id === 'string' && (entry.scope === 'conversation' || entry.scope === 'cyclone')
    && typeof entry.ownerId === 'string' && typeof entry.command === 'string' && typeof entry.startedAt === 'number'
    && (entry.surfaceId === undefined || typeof entry.surfaceId === 'string')
    && ['running', 'waiting', 'cancelling', 'completed', 'failed', 'cancelled', 'crashed'].includes(entry.status ?? '') && Array.isArray(entry.output)
    && (entry.kind === undefined || ['terminal', 'browser', 'computer'].includes(entry.kind))
    && (entry.viewer === undefined || ['terminal', 'browser', 'computer'].includes(entry.viewer))
    && (entry.progress === undefined || typeof entry.progress === 'string')
    && (entry.outputTruncated === undefined || typeof entry.outputTruncated === 'boolean')
    && (entry.promoted === undefined || typeof entry.promoted === 'boolean');
}

function isActive(status: ObservationStatus): boolean {
  return status === 'running' || status === 'waiting' || status === 'cancelling';
}

function latestOutputLine(output: ExecutionObservation['output']): string | undefined {
  let line = '';
  let latest = '';
  for (const { text } of output) {
    for (const char of text) {
      if (char === '\r' || char === '\n') { if (line.trim()) latest = line; line = ''; continue; }
      line += char;
    }
  }
  if (line.trim()) latest = line;
  // Build ESC dynamically so the ANSI matcher stays explicit without embedding
  // a control character in a regex literal (which ESLint correctly rejects).
  const ansiSequence = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const normalized = latest.replace(ansiSequence, '').trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(-180) : undefined;
}

export const executionObserver = new ExecutionObserver();
