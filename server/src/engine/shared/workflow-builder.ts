/**
 * 工作流搭建假工具 — 执行器
 *
 * 假工具 list_agents / create_workflow 的实现。
 * 由季风 session-runner 和对流 meeting-handlers 的 toolCaller 拦截后调用。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validateWorkflow, type ValidationError } from './workflow-validator';
import { autoLayout } from './workflow-layout';

// ── 类型 ──────────────────────────────────────────────────────────

/**
 * AI 提交的节点。字段名与 graph.json 的 config 结构保持一致，
 * 避免"翻译层"导致 AI 填错字段。
 */
export interface AINode {
  id: string;
  type: 'entry' | 'agent' | 'meeting' | 'note' | 'human-gate' | 'output';
  /** 节点显示名（必填，须是人类可读的角色名，如"规划者"，不能是"Agent"或类型名） */
  label: string;
  // ── agent 节点 ──
  /** 绑定的 agent 实体 id */
  agentId?: string;
  /** 该节点在本工作流中的职责说明 */
  role?: string;
  // ── entry 节点 ──
  /** 初始信封内容 */
  initialEnvelope?: string;
  // ── meeting 节点 ──
  /** 会长 agent 实体 id */
  chairAgentId?: string;
  /** 参与者节点 id 列表（指向本工作流内的 agent 节点） */
  participantNodeIds?: string[];
  // ── note 节点 ──
  /** 备注内容（注入到下游 agent） */
  content?: string;
  /** 备注作用的目标节点 id 列表 */
  targets?: string[];
  // ── human-gate 节点 ──
  /** 审查不通过时的退回目标节点 id */
  reworkTargetNodeId?: string;
}

/** AI 提交的边（统一用 source/target，兼容 from/to） */
export interface AIEdge {
  source: string;
  target: string;
}

/** AI 提交的完整参数 */
export interface CreateWorkflowParams {
  name: string;
  nodes: AINode[];
  edges: AIEdge[];
}

// ── 内部格式（对应 graph.json） ──────────────────────────────────

interface GraphNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  sourcePort: number;
  target: string;
  targetPort: number;
  kind: 'handoff' | 'note';
}

// ── list_agents ──────────────────────────────────────────────────

/** 列出所有已注册 agent，返回格式化字符串给 AI */
export async function execListAgents(dataDir: string): Promise<string> {
  const registryPath = path.join(dataDir, 'agents', 'registry.json');
  try {
    const raw = await fs.readFile(registryPath, 'utf-8');
    const registry = JSON.parse(raw) as Record<string, {
      id: string;
      name: string;
      role: string;
      config?: { rolePrompt?: string };
    }>;
    const list = Object.values(registry).map(a => ({
      agentId: a.id,
      name: a.name,
      role: a.role || (a.config?.rolePrompt?.slice(0, 60) ?? ''),
    }));
    if (list.length === 0) return '当前没有已注册的 Agent。请先创建 Agent 实体后再搭建工作流。';
    return JSON.stringify(list, null, 2);
  } catch (e) {
    return `读取 agent 注册表失败：${(e as Error).message}`;
  }
}

// ── create_workflow ──────────────────────────────────────────────

/**
 * 创建工作流，返回成功/失败信息给 AI。
 *
 * 接收 ReAct 循环传来的原始 args 对象（值均为 string），
 * 内部健壮处理三种 AI 写法：
 *   1. 带包装：{ params: "{...完整JSON...}" }
 *   2. 平铺且被 stringify：{ name:"x", nodes:"[...]", edges:"[...]" }
 *   3. 平铺正常：{ name:"x", nodes:[...], edges:[...] }（极少，但兜底）
 */
export async function execCreateWorkflow(
  dataDir: string,
  args: Record<string, unknown>,
): Promise<string> {
  // 1. 提取并解析参数（健壮处理多种写法）
  const parsed = extractParams(args);
  if (typeof parsed === 'string') return parsed; // 错误信息
  const params = parsed;

  if (!params.name || !Array.isArray(params.nodes) || !Array.isArray(params.edges)) {
    return '创建失败：缺少必填字段 name / nodes / edges，或 nodes/edges 不是数组。请确认 params 是包含这三个字段的 JSON 对象。';
  }

  // 1.5 归一化 edges：兼容 from/to 写法，统一为 source/target
  params.edges = params.edges.map(e => {
    const raw = e as Record<string, unknown>;
    return {
      source: (raw.source || raw.from || '') as string,
      target: (raw.target || raw.to || '') as string,
    };
  });

  // 2. 加载 agent 注册表（供校验）
  const registryPath = path.join(dataDir, 'agents', 'registry.json');
  let agentIds: Set<string>;
  try {
    const raw = await fs.readFile(registryPath, 'utf-8');
    agentIds = new Set(Object.keys(JSON.parse(raw)));
  } catch {
    return '创建失败：无法读取 agent 注册表。';
  }

  // 3. 校验
  const errors = validateWorkflow(params, agentIds);
  if (errors.length > 0) {
    const lines = errors.map((e, i) => `${i + 1}. ${e.message}`);
    return `创建失败，发现以下问题：\n${lines.join('\n')}\n\n请根据错误信息修正参数后重新调用 create_workflow。`;
  }

  // 4. 生成 graph.json 结构
  const positions = autoLayout(params.nodes, params.edges);
  const graphNodes: GraphNode[] = params.nodes.map(n => ({
    id: n.id,
    type: n.type,
    label: n.label || defaultLabel(n.type),
    position: positions.get(n.id) || { x: 1500, y: 1200 },
    config: buildNodeConfig(n),
  }));

  // 5. 生成 edges（handoff + note）
  const graphEdges: GraphEdge[] = [];
  // handoff 边
  for (const e of params.edges) {
    graphEdges.push({
      id: `e-${genShortId()}`,
      source: e.source,
      sourcePort: 0,
      target: e.target,
      targetPort: 0,
      kind: 'handoff',
    });
  }
  // note 边（从 note 节点到 targets）
  for (const n of params.nodes) {
    if (n.type === 'note' && n.targets) {
      for (const t of n.targets) {
        graphEdges.push({
          id: `e-${genShortId()}`,
          source: n.id,
          sourcePort: 0,
          target: t,
          targetPort: 0,
          kind: 'note',
        });
      }
    }
  }

  // 6. 写入文件
  const workflowId = `wf-${genShortId()}`;
  const wfDir = path.join(dataDir, 'tradewind', 'workflows', workflowId);
  const wsDir = path.join(wfDir, 'workspace');

  try {
    await fs.mkdir(wsDir, { recursive: true });
    const graph = { nodes: graphNodes, edges: graphEdges };
    await fs.writeFile(path.join(wfDir, 'graph.json'), JSON.stringify(graph, null, 2), 'utf-8');
    const meta = {
      workflowId,
      name: params.name,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(wfDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  } catch (e) {
    return `创建失败：写入文件时出错 — ${(e as Error).message}`;
  }

  return `工作流「${params.name}」已创建，ID: ${workflowId}。可在信风画布中查看和调整布局。`;
}

// ── 辅助 ──────────────────────────────────────────────────────────

/**
 * 从 ReAct 传来的 args 中健壮提取 CreateWorkflowParams。
 * 返回 string 表示出错（错误信息），返回对象表示成功。
 */
function extractParams(args: Record<string, unknown>): CreateWorkflowParams | string {
  // 情形 1：带 params/json 包装
  const wrapped = args.params ?? args.json;
  if (wrapped !== undefined) {
    if (typeof wrapped === 'string') {
      try {
        return JSON.parse(wrapped) as CreateWorkflowParams;
      } catch (e) {
        return `创建失败：params 不是合法 JSON — ${(e as Error).message}`;
      }
    }
    if (typeof wrapped === 'object' && wrapped !== null) {
      return wrapped as CreateWorkflowParams;
    }
  }

  // 情形 2/3：平铺写法 { name, nodes, edges }，其中 nodes/edges 可能被 stringify 成字符串
  if (args.name !== undefined && (args.nodes !== undefined || args.edges !== undefined)) {
    return {
      name: String(args.name),
      nodes: coerceArray(args.nodes),
      edges: coerceArray(args.edges),
    } as CreateWorkflowParams;
  }

  return '创建失败：未找到有效参数。请用 params 字段传入包含 name/nodes/edges 的 JSON 字符串。';
}

/** 把可能被 stringify 的值还原为数组；无法还原则返回空数组 */
function coerceArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildNodeConfig(n: AINode): Record<string, unknown> {
  switch (n.type) {
    case 'entry':
      return n.initialEnvelope ? { initialEnvelope: n.initialEnvelope } : {};
    case 'agent':
      return {
        agentId: n.agentId,
        ...(n.role ? { role: n.role } : {}),
      };
    case 'meeting':
      return {
        chairAgentId: n.chairAgentId,
        participantNodeIds: n.participantNodeIds || [],
      };
    case 'note':
      return { content: n.content || '' };
    case 'human-gate':
      return { reworkTargetNodeId: n.reworkTargetNodeId || '' };
    case 'output':
      return {};
    default:
      return {};
  }
}

function defaultLabel(type: string): string {
  const map: Record<string, string> = {
    entry: '入口', output: '输出', agent: 'Agent',
    meeting: '会议室', note: '备注', 'human-gate': '审查门',
  };
  return map[type] || type;
}

function genShortId(): string {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}

// ── Prompt 注入片段（给季风 / 对流共用） ──────────────────────────

/** 返回工作流搭建假工具的 prompt 说明段（追加到 system prompt 末尾） */
export function buildWorkflowToolsSection(): string {
  return `

## 工作流搭建能力

你可以帮用户搭建信风工作流。推荐流程：

1. 调 list_agents 查看可用 Agent
2. 通过对话澄清需求（目标、角色分工、是否需要会议室/审查门）
3. 如果缺少 Agent，用 ask 建议用户去创建（给出名称和 rolePrompt 示例）
4. **推荐**在调用 create_workflow 之前，先调用 ask 工具（<action tool="ask">）向用户确认方案：在 question 中列出节点编排和角色分配概要，给用户一个介入和调整的机会
5. 调 create_workflow 一次性生成

ask 是确认手段而非强制门槛——需求清晰时可直接创建，方案复杂或有多种取舍时建议先 ask 确认。

注意：ask 是工具调用，格式是 <action tool="ask">{"question":"..."}</action>，不是输出 <ask> 标签。

### list_agents
  描述: 列出框架内所有可用的 Agent 实体（id + 名称 + 角色）。
  参数: 无
  调用示例:
  <action tool="list_agents">{}</action>

### create_workflow
  描述: 创建一个完整的信风工作流。
  参数:
    params: string [必填] — JSON 字符串，包含 name、nodes、edges

  节点通用字段：
  - id: 节点唯一标识（如 "planner"、"reviewer"）
  - type: entry | agent | meeting | note | human-gate | output
  - label: 节点显示名，**必须是人类可读的角色名**（如"规划者"、"代码审校"），禁止用"Agent"或类型名占位

  各类型专属字段（字段名与系统内部一致，请严格使用）：
  - entry:      initialEnvelope（可选，初始信封内容）
  - agent:      agentId（必填）、role（该节点在本流程中的职责说明）
  - meeting:    chairAgentId（必填，会长）、participantNodeIds（必填，参与者节点 id 数组）
  - note:       content（必填，备注内容）、targets（注入到哪些 agent 节点 id）
  - human-gate: reworkTargetNodeId（可选，退回目标节点 id）
  - output:     无专属字段

  edges 字段：
  - 每条边：{ "source": "起点节点id", "target": "终点节点id" }

  调用示例:
  <action tool="create_workflow">{"params":"{\\"name\\":\\"示例\\",\\"nodes\\":[{\\"id\\":\\"entry\\",\\"type\\":\\"entry\\",\\"label\\":\\"入口\\"},{\\"id\\":\\"planner\\",\\"type\\":\\"agent\\",\\"label\\":\\"规划者\\",\\"agentId\\":\\"agent-xxx\\",\\"role\\":\\"拆解任务为子步骤\\"},{\\"id\\":\\"out\\",\\"type\\":\\"output\\",\\"label\\":\\"输出\\"}],\\"edges\\":[{\\"source\\":\\"entry\\",\\"target\\":\\"planner\\"},{\\"source\\":\\"planner\\",\\"target\\":\\"out\\"}]}"}</action>

  注意：
  - 必须先 list_agents 确认 agentId 真实存在
  - participantNodeIds 填的是同工作流内 agent 节点的 id，不是 agentId
  - label 必须体现节点职责，与你在 ask 中向用户展示的角色名保持一致
  - 如果返回错误，根据错误信息修正后重新调用，不要放弃`;
}
