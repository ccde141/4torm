import { readJson, writeJson, deleteFile, ensureDir } from '../api/storage';
import type { SandboxWorkflow, ExecutionState } from '../types/sandbox';

const WF_DIR = 'workflows';

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

async function wfDir(name: string): Promise<string> {
  const s = sanitize(name);
  const dir = `${WF_DIR}/${s}`;
  await ensureDir(dir);
  return s;
}

async function registryPath(): Promise<string> {
  await ensureDir(WF_DIR);
  return `${WF_DIR}/_registry.json`;
}

async function readRegistry(): Promise<Record<string, string>> {
  const data = await readJson<Record<string, string>>(await registryPath());
  if (!data || Array.isArray(data)) return {};
  return data;
}

export async function getWorkflows(): Promise<SandboxWorkflow[]> {
  const registry = await readRegistry();
  const names = Object.keys(registry);
  if (names.length === 0) return [];
  const workflows: SandboxWorkflow[] = [];
  for (const name of names) {
    const wf = await readJson<SandboxWorkflow>(`${WF_DIR}/${name}/${name}.json`);
    if (wf) workflows.push(wf);
  }
  return workflows;
}

export async function createWorkflow(name: string, description: string): Promise<SandboxWorkflow> {
  const registry = await readRegistry();
  const s = sanitize(name);
  if (registry[s] || registry[name]) {
    throw new Error(`工作流 "${name}" 已存在，请使用其他名称`);
  }
  const now = new Date().toISOString();
  const wf: SandboxWorkflow = {
    id: `wf-${Date.now().toString(36)}`,
    name,
    description,
    nodes: [],
    edges: [],
    activeAgentIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(`${WF_DIR}/${s}/${s}.json`, wf);
  registry[s] = wf.id;
  await writeJson(await registryPath(), registry);
  return wf;
}

export async function saveWorkflow(wf: SandboxWorkflow): Promise<void> {
  wf.updatedAt = new Date().toISOString();
  const registry = await readRegistry();
  const s = sanitize(wf.name);

  const existingName = Object.keys(registry).find(k => registry[k] === wf.id);
  if (existingName && sanitize(existingName) !== s) {
    for (const [regName, regId] of Object.entries(registry)) {
      if (sanitize(regName) === s && regId !== wf.id) {
        throw new Error(`工作流 "${wf.name}" 已存在，请使用其他名称`);
      }
    }
    await ensureDir(`${WF_DIR}/${s}`);
    await writeJson(`${WF_DIR}/${s}/${s}.json`, wf);
    try { await deleteFile(`${WF_DIR}/${sanitize(existingName)}`); } catch { /* ok */ }
    delete registry[existingName];
    registry[s] = wf.id;
    await writeJson(await registryPath(), registry);
    return;
  }

  if (!registry[s]) {
    for (const [regName, regId] of Object.entries(registry)) {
      if (sanitize(regName) === s && regId !== wf.id) {
        throw new Error(`工作流 "${wf.name}" 已存在，请使用其他名称`);
      }
    }
    registry[s] = wf.id;
  }

  await ensureDir(`${WF_DIR}/${s}`);
  await writeJson(`${WF_DIR}/${s}/${s}.json`, wf);
  await writeJson(await registryPath(), registry);
}

export async function importWorkflow(jsonStr: string): Promise<SandboxWorkflow> {
  let raw: any;
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    throw new Error('无法解析 JSON 文件，请确认文件格式正确');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('无法识别工作流：JSON 根节点必须是对象');
  }
  if (!raw.name || typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new Error('无法识别工作流：缺少有效的 name 字段');
  }
  if (!Array.isArray(raw.nodes)) {
    throw new Error('无法识别工作流：缺少有效的 nodes 数组');
  }
  if (!Array.isArray(raw.edges)) {
    throw new Error('无法识别工作流：缺少有效的 edges 数组');
  }

  const s = sanitize(raw.name.trim());
  const registry = await readRegistry();
  if (registry[s] !== undefined) {
    throw new Error(`工作流 "${raw.name.trim()}" 已存在，请使用其他名称`);
  }

  const now = new Date().toISOString();
  const wf: SandboxWorkflow = {
    id: `wf-${Date.now().toString(36)}`,
    name: raw.name.trim(),
    description: raw.description || '',
    nodes: raw.nodes,
    edges: raw.edges,
    activeAgentIds: Array.isArray(raw.activeAgentIds) ? raw.activeAgentIds : [],
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };

  await ensureDir(`${WF_DIR}/${s}`);
  await writeJson(`${WF_DIR}/${s}/${s}.json`, wf);
  registry[s] = wf.id;
  await writeJson(await registryPath(), registry);
  return wf;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const registry = await readRegistry();
  const entry = Object.entries(registry).find(([_, rid]) => rid === id);
  if (!entry) return;
  const [name] = entry;
  const s = sanitize(name);
  try { await deleteFile(`${WF_DIR}/${s}`); } catch { /* ok */ }
  delete registry[name];
  await writeJson(await registryPath(), registry);
}

export async function getExecutionState(flowName: string): Promise<ExecutionState | null> {
  const s = sanitize(flowName);
  return readJson<ExecutionState>(`${WF_DIR}/${s}/${s}_exec.json`);
}

export async function saveExecutionState(flowName: string, state: ExecutionState): Promise<void> {
  const s = sanitize(flowName);
  await ensureDir(`${WF_DIR}/${s}`);
  await writeJson(`${WF_DIR}/${s}/${s}_exec.json`, state);
}

export async function clearExecutionState(flowName: string): Promise<void> {
  const s = sanitize(flowName);
  try { await deleteFile(`${WF_DIR}/${s}/${s}_exec.json`); } catch { /* ok */ }
}

export function createInitialExecutionState(): ExecutionState {
  return {
    status: 'idle',
    currentNodeId: null,
    envelopes: {},
    logs: [],
    variables: {},
  };
}
