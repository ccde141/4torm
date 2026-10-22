import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSeat } from '../../../engine/cyclone/seat-store.js';
import { dispatchesDir, seatFile } from '../../../engine/cyclone/paths.js';
import { loadDispatch, type CycloneDispatch } from '../../../engine/cyclone/dispatch-store.js';
import { readSeatMemorySummary, seatMemoryFile } from '../../../engine/cyclone/seat-memory.js';
import { readSeatHistory, type SeatHistoryRecord } from '../../../engine/cyclone/seat-history.js';
import { loadAgent } from '../../../engine/shared/agent-loader.js';
import { loadAgentToolDefs } from '../../../engine/shared/tool-defs-loader.js';
import { skillDir } from '../../../services/data-paths.js';
import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneConsoleCapabilities, CycloneSeatCollaboration } from '../domain/console.js';

export interface CycloneSeatMetadata {
  id: string;
  agentId: string;
  title: string;
  duty?: string;
  rolePrompt: string;
  overrideAgentRole: boolean;
  pending: boolean;
  createdAt: string;
  updatedAt: string;
  collaboration: CycloneSeatCollaboration;
}

/** Cache only metadata; large private histories never remain in this projection. */
export class CycloneConsoleSource {
  private readonly histories = new Map<string, { revision: string; value: SeatHistoryRecord[] }>();
  private readonly seats = new Map<string, {
    revision: string; value: CycloneSeatMetadata;
  }>();
  private readonly agents = new Map<string, {
    signature: string; expiresAt: number; value: CycloneConsoleCapabilities;
  }>();
  private readonly memories = new Map<string, { revision: string; count: number }>();
  private readonly dispatchItems = new Map<string, {
    revision: string; value: CycloneDispatch;
  }>();

  constructor(private readonly dataDir: string) {}

  dispose(): void {
    this.seats.clear(); this.agents.clear(); this.memories.clear(); this.dispatchItems.clear(); this.histories.clear();
  }

  async history(workshopId: string, seatId: string): Promise<SeatHistoryRecord[]> {
    const file = seatFile(this.dataDir, workshopId, seatId);
    const revision = (await Promise.all([fileRevision(file),
      fileRevision(seatMemoryFile(this.dataDir, workshopId, seatId))])).join(':');
    const cached = this.histories.get(file);
    if (cached?.revision === revision) return structuredClone(cached.value);
    try {
      // Keep all change metadata for real pagination, never conversation or memory bodies.
      const value = await readSeatHistory(this.dataDir, workshopId, seatId);
      this.histories.set(file, { revision, value });
      return structuredClone(value);
    } catch (error) { this.histories.delete(file); throw error; }
  }

  async memoryCount(workshopId: string, seatId: string): Promise<number> {
    const file = seatMemoryFile(this.dataDir, workshopId, seatId);
    const identity = await fileRevision(file);
    const revision = identity === 'missing'
      ? `missing:${await fileRevision(path.dirname(file))}` : identity;
    const cached = this.memories.get(file);
    if (cached?.revision === revision) return cached.count;
    try {
      const count = (await readSeatMemorySummary(this.dataDir, workshopId, seatId)).memoryCount;
      this.memories.set(file, { revision, count });
      return count;
    } catch (error) {
      this.memories.delete(file);
      throw error;
    }
  }

  async dispatches(workshopId: string): Promise<CycloneDispatch[]> {
    const directory = dispatchesDir(this.dataDir, workshopId);
    let names: string[];
    try { names = await fs.readdir(directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    if (names.some(name => name.includes('.json.corrupt-')
      && !names.includes(name.slice(0, name.indexOf('.json.corrupt-') + 5)))) {
      throw frameworkError({ code: 'CYCLONE_STORE_CORRUPT', kind: 'io',
        message: '气旋派发记录已损坏并隔离', source: 'cyclone.console', retryable: false });
    }
    // Inspect cheap file identities; only changed records need their task/result
    // JSON parsed. Retain the small projection rather than private result bodies.
    const values = await Promise.all(names.filter(name => name.endsWith('.json')).map(async name => {
      const file = path.join(directory, name);
      const revision = await fileRevision(file);
      const cached = this.dispatchItems.get(file);
      if (cached?.revision === revision) return cached.value;
      const item = await loadDispatch(this.dataDir, workshopId, name.slice(0, -5));
      if (!item) return null;
      if (item.id !== name.slice(0, -5) || item.workshopId !== workshopId
        || typeof item.sourceSeatId !== 'string' || typeof item.targetSeatId !== 'string'
        || typeof item.sourceSeatTitle !== 'string' || typeof item.targetSeatTitle !== 'string'
        || !validTime(item.createdAt) || !validTime(item.updatedAt)) {
        throw frameworkError({ code: 'CYCLONE_DISPATCH_METADATA_INVALID', kind: 'io',
          message: '气旋派发概览数据无效', source: 'cyclone.console', retryable: false });
      }
      const value: CycloneDispatch = { ...item, task: '', response: undefined };
      this.dispatchItems.set(file, { revision, value });
      return value;
    }));
    return values.filter((item): item is CycloneDispatch => item !== null);
  }

  async seat(workshopId: string, seatId: string): Promise<CycloneSeatMetadata> {
    const file = seatFile(this.dataDir, workshopId, seatId);
    const stat = await fs.stat(file);
    const revision = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    const cached = this.seats.get(file);
    if (cached?.revision === revision) return structuredClone(cached.value);
    const seat = await loadSeat(this.dataDir, workshopId, seatId);
    if (!seat || seat.id !== seatId || typeof seat.agentId !== 'string'
      || typeof seat.title !== 'string' || typeof seat.rolePrompt !== 'string'
      || !validTime(seat.createdAt) || !validTime(seat.updatedAt)) {
      throw frameworkError({ code: 'CYCLONE_SEAT_METADATA_INVALID', kind: 'io',
        message: '工位概览数据无效', source: 'cyclone.console', retryable: false });
    }
    const local = (seat as typeof seat & { collaboration?: Partial<CycloneSeatCollaboration> })
      .collaboration;
    const value: CycloneSeatMetadata = {
      id: seat.id, agentId: seat.agentId, title: seat.title, duty: seat.duty,
      rolePrompt: seat.rolePrompt, overrideAgentRole: seat.overrideAgentRole === true,
      pending: Boolean(seat.pending), createdAt: seat.createdAt, updatedAt: seat.updatedAt,
      collaboration: { contact: local?.contact !== false, dispatch: local?.dispatch !== false,
        bulletin: local?.bulletin !== false },
    };
    this.seats.set(file, { revision, value });
    return structuredClone(value);
  }

  async capabilities(agentId: string): Promise<CycloneConsoleCapabilities> {
    const agent = await loadAgent(this.dataDir, agentId);
    if (!agent) return { available: false, agentName: agentId, model: '', tools: [], skills: [] };
    const signature = JSON.stringify([agent.name, agent.model, agent.tools, agent.skills, agent.toolMode]);
    const cached = this.agents.get(agentId);
    if (cached?.signature === signature && cached.expiresAt > Date.now()) {
      return structuredClone(cached.value);
    }
    const [tools, skills] = await Promise.all([
      loadAgentToolDefs(this.dataDir, agent.tools, agent.skills, agent.toolMode),
      Promise.all(agent.skills.map(id => this.skill(id))),
    ]);
    const value = { available: true, agentName: agent.name, model: agent.model,
      tools: tools.map(tool => ({ name: tool.name, description: tool.description })), skills };
    this.agents.set(agentId, { signature, expiresAt: Date.now() + 5_000, value });
    return structuredClone(value);
  }

  private async skill(id: string): Promise<{ id: string; name: string; description: string }> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(id)) {
      return { id, name: id, description: '技能标识无效' };
    }
    try {
      const raw: unknown = JSON.parse(await fs.readFile(
        path.join(skillDir(this.dataDir, id), 'config.json'), 'utf8'));
      const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      return { id, name: typeof item.name === 'string' ? item.name : id,
        description: typeof item.description === 'string' ? item.description : '' };
    } catch (error) {
      return { id, name: id, description: (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? '技能元数据不存在' : '技能元数据不可读' };
    }
  }
}

async function fileRevision(file: string): Promise<string> {
  try {
    const stat = await fs.stat(file);
    return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

function validTime(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
