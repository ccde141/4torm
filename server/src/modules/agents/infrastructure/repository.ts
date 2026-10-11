import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../../../engine/shared/atomic-io.js';
import { agentRegistryFile, agentWorkspaceDir } from '../../../services/data-paths.js';
import type { AgentConfigRecord, AgentRecord, CreateAgentInput } from '../domain/agent.js';

type Registry = Record<string, AgentRecord>;

export class AgentRepository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  list(): Promise<AgentRecord[]> {
    return this.lock(async () => Object.values(await this.readRegistry()));
  }

  create(input: CreateAgentInput): Promise<AgentRecord> {
    return this.lock(async () => {
      const registry = await this.readRegistry();
      const id = nextAgentId(registry);
      const now = new Date().toISOString();
      const config = { ...input.config,
        workspace: input.config.workspace || `data/agents/${id}/.workspace/` };
      const agent: AgentRecord = { id, name: input.name, role: input.role,
        description: input.description, status: 'idle', model: input.model, config,
        createdAt: now, updatedAt: now, tasksCompleted: 0 };
      await this.persistNewAgent(agent, registry);
      return agent;
    });
  }

  update(id: string, patch: Partial<AgentRecord>): Promise<AgentRecord> {
    return this.lock(async () => {
      const registry = await this.readRegistry();
      const current = required(registry, id);
      const agent = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
      registry[id] = agent;
      await this.writeRegistry(registry);
      return agent;
    });
  }

  updateConfig(
    id: string,
    config: AgentConfigRecord,
    model: string,
    patch: Partial<AgentRecord>,
  ): Promise<AgentRecord> {
    return this.lock(async () => {
      const registry = await this.readRegistry();
      const current = required(registry, id);
      const complete = { ...config, workspace: config.workspace || current.config.workspace };
      await this.writeWorkspace(id, complete, model, false);
      const agent = { ...current, ...patch, id, model, config: complete,
        updatedAt: new Date().toISOString() };
      registry[id] = agent;
      await this.writeRegistry(registry);
      return agent;
    });
  }

  delete(id: string): Promise<boolean> {
    return this.lock(async () => {
      const registry = await this.readRegistry();
      if (!registry[id]) return false;
      delete registry[id];
      await this.writeRegistry(registry);
      await fs.rm(path.join(this.dataDir, 'agents', id), { recursive: true, force: true });
      return true;
    });
  }

  private async persistNewAgent(agent: AgentRecord, registry: Registry): Promise<void> {
    const directory = path.join(this.dataDir, 'agents', agent.id);
    try {
      await this.writeWorkspace(agent.id, agent.config, agent.model, true);
      registry[agent.id] = agent;
      await this.writeRegistry(registry);
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  private async writeWorkspace(
    id: string, config: AgentConfigRecord, model: string, initialize: boolean,
  ): Promise<void> {
    const directory = agentWorkspaceDir(this.dataDir, id);
    await fs.mkdir(directory, { recursive: true });
    await atomicWriteFile(path.join(directory, 'role-prompt.md'), config.rolePrompt || '');
    if (initialize) await atomicWriteFile(path.join(directory, 'MEMORY.md'), '');
    const stored = { temperature: config.temperature, tools: config.tools || [],
      toolMode: config.toolMode, skills: config.skills || [], model };
    await atomicWriteFile(path.join(directory, 'config.json'), JSON.stringify(stored, null, 2));
  }

  private async readRegistry(): Promise<Registry> {
    try {
      const value = JSON.parse(await fs.readFile(agentRegistryFile(this.dataDir), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent registry 数据无效');
      return value as Registry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async writeRegistry(registry: Registry): Promise<void> {
    const file = agentRegistryFile(this.dataDir);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, JSON.stringify(registry, null, 2));
  }

  private lock<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(work, work);
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
}

function nextAgentId(registry: Registry): string {
  for (;;) {
    const id = `agent-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    if (!registry[id]) return id;
  }
}

function required(registry: Registry, id: string): AgentRecord {
  const agent = registry[id];
  if (!agent) throw new Error('Agent 不存在');
  return agent;
}
