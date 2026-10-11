export interface AgentConfigRecord {
  masterPrompt?: string;
  rolePrompt?: string;
  compactionPrompt?: string;
  temperature?: number;
  tools?: string[];
  toolMode?: 'all' | 'selected';
  skills?: string[];
  workspace?: string;
  sandboxLevel?: 'project' | 'unrestricted' | 'strict' | 'relaxed';
}

export interface AgentRecord {
  id: string;
  name: string;
  role: string;
  status: string;
  /** 旧数据只读字段，不再接受新的标签写入。 */
  label?: string;
  avatar?: { version: number };
  model: string;
  description: string;
  config: AgentConfigRecord;
  createdAt: string;
  updatedAt: string;
  lastActivity?: string;
  tasksCompleted: number;
}

export interface CreateAgentInput {
  name: string;
  role: string;
  description: string;
  model: string;
  config: AgentConfigRecord;
}

export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentValidationError';
  }
}

export function parseCreateAgent(value: unknown): CreateAgentInput {
  const input = object(value, 'Agent 创建参数无效');
  assertNoLabelWrite(input);
  return {
    name: text(input.name, 'Agent 名称', 200),
    role: text(input.role, 'Agent 角色', 500, true),
    description: text(input.description, 'Agent 描述', 4_000, true),
    model: text(input.model, 'Agent 模型', 500, true),
    config: parseConfig(input.config),
  };
}

export function parseAgentPatch(value: unknown): Partial<AgentRecord> {
  const input = object(value, 'Agent 更新参数无效');
  assertNoLabelWrite(input);
  const patch: Partial<AgentRecord> = {};
  if (input.name !== undefined) patch.name = text(input.name, 'Agent 名称', 200);
  if (input.role !== undefined) patch.role = text(input.role, 'Agent 角色', 500, true);
  if (input.description !== undefined) patch.description = text(input.description, 'Agent 描述', 4_000, true);
  if (input.model !== undefined) patch.model = text(input.model, 'Agent 模型', 500, true);
  if (input.avatar !== undefined) patch.avatar = parseAvatar(input.avatar);
  return patch;
}

function assertNoLabelWrite(input: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(input, 'label')) {
    throw new AgentValidationError('Agent 分类标签已停用');
  }
}

export function parseAgentConfig(value: unknown): AgentConfigRecord {
  return parseConfig(value);
}

export function assertAgentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(value)) {
    throw new AgentValidationError('Agent ID 无效');
  }
  return value;
}

function parseConfig(value: unknown): AgentConfigRecord {
  const input = value === undefined ? {} : object(value, 'Agent 配置无效');
  const config: AgentConfigRecord = {};
  for (const field of ['masterPrompt', 'rolePrompt', 'compactionPrompt', 'workspace'] as const) {
    if (input[field] !== undefined) config[field] = text(input[field], field, 200_000, true);
  }
  if (input.temperature !== undefined) {
    const temperature = Number(input.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
      throw new AgentValidationError('temperature 无效');
    }
    config.temperature = temperature;
  }
  if (input.tools !== undefined) config.tools = strings(input.tools, 'tools');
  if (input.skills !== undefined) config.skills = strings(input.skills, 'skills');
  if (input.toolMode !== undefined) {
    if (!['all', 'selected'].includes(String(input.toolMode))) {
      throw new AgentValidationError('toolMode 无效');
    }
    config.toolMode = input.toolMode as AgentConfigRecord['toolMode'];
  }
  if (input.sandboxLevel !== undefined) {
    const allowed = ['project', 'unrestricted', 'strict', 'relaxed'];
    if (!allowed.includes(String(input.sandboxLevel))) {
      throw new AgentValidationError('sandboxLevel 无效');
    }
    config.sandboxLevel = input.sandboxLevel as AgentConfigRecord['sandboxLevel'];
  }
  return config;
}

function parseAvatar(value: unknown): { version: number } | undefined {
  if (value === null) return undefined;
  const input = object(value, 'Agent 头像版本无效');
  if (!Number.isFinite(input.version) || Number(input.version) <= 0) {
    throw new AgentValidationError('Agent 头像版本无效');
  }
  return { version: Number(input.version) };
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length > 200)) {
    throw new AgentValidationError(`${name} 无效`);
  }
  return [...new Set(value)];
}

function text(value: unknown, name: string, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) {
    throw new AgentValidationError(`${name}无效`);
  }
  return value;
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentValidationError(message);
  }
  return value as Record<string, unknown>;
}
