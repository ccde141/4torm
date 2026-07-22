import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from './atomic-io.js';
import type { ToolDef } from './tool-defs-loader.js';
import { toolExecutorDir, toolRegistryFile } from '../../services/data-paths.js';

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const RESERVED_NAMES = new Set([
  'ask', 'delegate', 'task_board', 'review_changes', 'register_tool',
  'list_agents', 'create_workflow', 'list_workflows', 'update_workflow',
  'create_automation', 'update_automation', 'list_automations',
  'contact', 'dispatch', 'bulletin', 'complete_task',
]);

export interface RegisteredToolDefinition {
  name: string;
  description: string;
  category: 'custom';
  dangerous: boolean;
  executorType: 'custom';
  executorFile: string;
  parameters: Record<string, unknown>;
}

export interface ToolRegistrationProposal {
  tool: RegisteredToolDefinition;
}

let mutationTail: Promise<void> = Promise.resolve();

function enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(task, task);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

async function readRegistry(dataDir: string): Promise<RegisteredToolDefinition[]> {
  try {
    const raw = await fs.readFile(toolRegistryFile(dataDir), 'utf8');
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) throw new Error('工具注册表格式无效');
    return value as RegisteredToolDefinition[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少 ${field}`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${field} 不能超过 ${max} 个字符`);
  return text;
}

function parseDangerous(value: unknown): boolean {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('dangerous 必须为 true 或 false');
}

function parseParameters(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); }
    catch { throw new Error('parameters 必须是有效的 JSON 对象'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('parameters 必须是 JSON 对象');
  }
  const schema = parsed as Record<string, unknown>;
  if (schema.type !== 'object') throw new Error('parameters.type 必须为 object');
  if (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) {
    throw new Error('parameters.properties 必须是对象');
  }
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some(item => typeof item !== 'string'))) {
    throw new Error('parameters.required 必须是字符串数组');
  }
  return schema;
}

async function assertExecutorExists(dataDir: string, executorFile: string): Promise<void> {
  try {
    const stat = await fs.stat(path.join(toolExecutorDir(dataDir), `${executorFile}.js`));
    if (!stat.isFile()) throw new Error('not-file');
  } catch {
    throw new Error(`执行器不存在：data/tools/executors/${executorFile}.js`);
  }
}

async function findSkillToolOwner(dataDir: string, toolName: string): Promise<string | null> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(path.join(dataDir, 'skills'), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await fs.readFile(path.join(dataDir, 'skills', entry.name, 'tools.json'), 'utf8');
      const tools = JSON.parse(raw) as Array<{ name?: unknown }>;
      if (Array.isArray(tools) && tools.some(tool => tool?.name === toolName)) return entry.name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}

export async function prepareToolRegistration(
  dataDir: string,
  args: Record<string, unknown>,
): Promise<ToolRegistrationProposal> {
  const name = requiredText(args.name, 'name', 64);
  if (!TOOL_NAME.test(name)) throw new Error('工具名称只能使用小写字母、数字和下划线，并以字母开头');
  if (RESERVED_NAMES.has(name)) throw new Error(`工具名称属于框架保留名称：${name}`);
  const executorFile = requiredText(args.executorFile ?? name, 'executorFile', 64);
  if (!TOOL_NAME.test(executorFile)) throw new Error('executorFile 只能使用小写字母、数字和下划线');

  const registry = await readRegistry(dataDir);
  if (registry.some(tool => tool.name === name)) throw new Error(`工具已经注册：${name}`);
  const skillOwner = await findSkillToolOwner(dataDir, name);
  if (skillOwner) throw new Error(`工具名称已由技能「${skillOwner}」提供：${name}`);
  await assertExecutorExists(dataDir, executorFile);

  return {
    tool: {
      name,
      description: requiredText(args.description, 'description', 1000),
      category: 'custom',
      dangerous: parseDangerous(args.dangerous),
      executorType: 'custom',
      executorFile,
      parameters: parseParameters(args.parameters),
    },
  };
}

export async function commitToolRegistration(
  dataDir: string,
  proposal: ToolRegistrationProposal,
): Promise<string> {
  return enqueueMutation(async () => {
    await assertExecutorExists(dataDir, proposal.tool.executorFile);
    const registry = await readRegistry(dataDir);
    const skillOwner = await findSkillToolOwner(dataDir, proposal.tool.name);
    if (skillOwner) throw new Error(`工具名称已由技能「${skillOwner}」提供：${proposal.tool.name}`);
    const existing = registry.find(tool => tool.name === proposal.tool.name);
    if (existing && JSON.stringify(existing) === JSON.stringify(proposal.tool)) {
      return `工具「${proposal.tool.name}」已经注册，无需重复写入。`;
    }
    if (existing) {
      throw new Error(`工具已经注册：${proposal.tool.name}`);
    }
    await fs.mkdir(path.dirname(toolRegistryFile(dataDir)), { recursive: true });
    await atomicWriteFile(toolRegistryFile(dataDir), JSON.stringify([...registry, proposal.tool], null, 2));
    return `工具「${proposal.tool.name}」已注册。可在 Agent 配置中启用。`;
  });
}

export function isToolRegistrationApproved(answer: string): boolean {
  return ['注册', '确认', '同意', 'yes', 'y', 'confirm'].includes(answer.trim().toLowerCase());
}

export async function resolveToolRegistration(
  dataDir: string,
  proposal: ToolRegistrationProposal,
  answer: string,
): Promise<{ result: string; ok: boolean }> {
  if (!isToolRegistrationApproved(answer)) {
    return { result: `已取消注册工具「${proposal.tool.name}」。`, ok: true };
  }
  try {
    return { result: await commitToolRegistration(dataDir, proposal), ok: true };
  } catch (error) {
    return { result: `工具注册失败：${(error as Error).message}`, ok: false };
  }
}

export function toolRegistrationArgs(proposal: ToolRegistrationProposal): Record<string, string> {
  return {
    name: proposal.tool.name,
    description: proposal.tool.description,
    dangerous: String(proposal.tool.dangerous),
    executorFile: proposal.tool.executorFile,
    parameters: JSON.stringify(proposal.tool.parameters),
  };
}

export function buildRegisterToolDef(): ToolDef {
  return {
    name: 'register_tool',
    description: '注册一个已经写好执行器的独立全局工具。调用后系统会向人类展示确认，确认前不会修改工具注册表。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '工具名称：小写字母、数字和下划线，以字母开头' },
        description: { type: 'string', description: '工具用途和适用场景' },
        dangerous: { type: 'string', description: "是否具有写入、删除或命令执行能力：'true' 或 'false'" },
        executorFile: { type: 'string', description: 'data/tools/executors/ 下不含 .js 的执行器文件名' },
        parameters: { type: 'string', description: '工具参数的 JSON Schema 对象，序列化为 JSON 字符串' },
      },
      required: ['name', 'description', 'dangerous', 'executorFile', 'parameters'],
    },
  };
}
