/**
 * 工作流搭建假工具 — 执行器
 *
 * 假工具 list_agents / create_workflow 的实现。
 * 由季风 session-runner 和对流 meeting-handlers 的 toolCaller 拦截后调用。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from './atomic-io';
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
  /** 投递延迟秒数：产出后、投递下游前盲等（抗外部节拍）。默认 0=无延迟 */
  deliveryDelaySec?: number;
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

export type { GraphNode, GraphEdge };

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
    const raw = e as unknown as Record<string, unknown>;
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

  // 4-5. 生成 graph 结构（节点 + handoff/note 边）
  const graph = buildGraphFromParams(params);

  // 6. 写入文件
  const workflowId = `wf-${genShortId()}`;
  const wfDir = path.join(dataDir, 'tradewind', 'workflows', workflowId);
  const wsDir = path.join(wfDir, 'workspace');

  try {
    await fs.mkdir(wsDir, { recursive: true });
    await atomicWriteFile(path.join(wfDir, 'graph.json'), JSON.stringify(graph, null, 2));
    const meta = {
      workflowId,
      name: params.name,
      updatedAt: new Date().toISOString(),
    };
    await atomicWriteFile(path.join(wfDir, 'meta.json'), JSON.stringify(meta, null, 2));
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
export function extractParams(args: Record<string, unknown>): CreateWorkflowParams | string {
  // 情形 1：带 params/json 包装
  const wrapped = args.params ?? args.json;
  if (wrapped !== undefined) {
    if (typeof wrapped === 'string') {
      try {
        return JSON.parse(wrapped) as CreateWorkflowParams;
      } catch (e) {
        return `参数错误：params 不是合法 JSON — ${(e as Error).message}`;
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

  return '参数错误：未找到有效参数。请用 params 字段传入包含 name/nodes/edges 的 JSON 字符串。';
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
        ...(typeof n.deliveryDelaySec === 'number' && n.deliveryDelaySec > 0
          ? { deliveryDelaySec: n.deliveryDelaySec }
          : {}),
      };
    case 'meeting':
      return {
        chairAgentId: n.chairAgentId,
        participantNodeIds: n.participantNodeIds || [],
      };
    case 'note':
      return { content: n.content || '' };
    case 'human-gate':
      return {};
    case 'output':
      return {};
    default:
      return {};
  }
}

/**
 * 从校验通过的 params 生成 graph.json 结构（节点 + handoff/note 边）。
 * @param existingPositions 已有节点的坐标（update 时传入，按 id 沿用，保留用户手调布局）；
 *   未提供坐标的节点（新增节点）走 autoLayout。
 */
export function buildGraphFromParams(
  params: CreateWorkflowParams,
  existingPositions?: Map<string, { x: number; y: number }>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const layout = autoLayout(params.nodes, params.edges);
  const graphNodes: GraphNode[] = params.nodes.map(n => ({
    id: n.id,
    type: n.type,
    label: n.label || defaultLabel(n.type),
    // 雷2 防护：已有节点沿用原坐标，仅新增节点用 autoLayout，不冲掉用户排版
    position: existingPositions?.get(n.id) || layout.get(n.id) || { x: 1500, y: 1200 },
    config: buildNodeConfig(n),
  }));

  const graphEdges: GraphEdge[] = [];
  for (const e of params.edges) {
    graphEdges.push({
      id: `e-${genShortId()}`,
      source: e.source, sourcePort: 0,
      target: e.target, targetPort: 0,
      kind: 'handoff',
    });
  }
  for (const n of params.nodes) {
    if (n.type === 'note' && n.targets) {
      for (const t of n.targets) {
        graphEdges.push({
          id: `e-${genShortId()}`,
          source: n.id, sourcePort: 0,
          target: t, targetPort: 0,
          kind: 'note',
        });
      }
    }
  }

  return { nodes: graphNodes, edges: graphEdges };
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

### 信风是什么（先建立画面再动手）

信风是多 Agent 协作流水线。一个「信封」（纯文本）从 entry 出发，流经各节点被读取、改写、传递，到 output 终止。

节点 = 信封到了谁手里：
- entry：起点，写入初始需求
- agent：一个 AI 独自读信封→干活→把 <answer> 自动打包成新信封传给下游；运行中人类可随时找它对话
- meeting：多个 AI 圆桌讨论，会长汇总纪要，结果写入信封
- human-gate：暂停，人类查看/编辑信封内容后点继续，编辑后的内容流向下游
- note：贴在 agent 身上的便签（固定提示词），不参与信封流动，也可独立悬空当备注
- output：终点，信封到此结束，并归档全程记录

边 = 信封的走法：
- 串行 A→B→C：依次传递
- 广播 A→B、A→C：信封复制成两份，各自独立流（不是二选一，没有条件分叉）
- 汇聚 B→D、C→D：B 和 C 都完成后，两份内容拼接进 D

你可以帮用户搭建信风工作流。推荐流程：

1. 调 list_agents 查看可用 Agent
2. 通过对话澄清需求（目标、角色分工、是否需要会议室、是否需要人类暂停点）
3. 如果缺少 Agent，用 ask 建议用户去创建（给出名称和 rolePrompt 示例）
4. **推荐**在调用 create_workflow 之前，先调用 ask 工具（<action tool="ask">）向用户确认方案：在 question 中列出节点编排和角色分配概要，给用户一个介入和调整的机会
5. 调 create_workflow 一次性生成

ask 是确认手段而非强制门槛——需求清晰时可直接创建，方案复杂或有多种取舍时建议先 ask 确认。

注意：ask 是工具调用，格式是 <action tool="ask">{"question":"..."}</action>，不是输出 <ask> 标签。

### 信风引擎的真实能力边界（务必遵守，不要设计引擎做不到的结构）

- **工作流必须是 DAG（有向无环图）**：信封只能单向从上游流向下游，**严禁任何回边/循环**（如"审查后退回上一步再跑一轮"）。需要迭代时，应展开成多个串行节点，而不是连一条回去的边。
- **没有条件分叉**：一个节点若有多条出边，信封会被**复制广播**到所有下游节点（它们会同时各跑一次），**不是二选一**。引擎不支持"满足条件走 A，否则走 B"的路由。
- **human-gate（暂停点）只是一个线性暂停**：信封到达时流程挂起，人类可编辑信封内容后点"继续"，编辑后的内容继续流向下游。它**没有"批准/打回/rework"概念，也不能分叉**，就是一个让人类介入查看和修改信封的关卡。
- **Entry 必须存在；Output 有且只有一个**。

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
  - agent:      agentId（必填）、role（该节点在本流程中的职责说明）、deliveryDelaySec（可选，投递延迟秒数，默认 0）
                deliveryDelaySec：该节点产出后、投递给下游前盲等的秒数。用于对抗外部环境节拍
                （如需等外部系统处理完再往下走）。绝大多数节点填 0 或省略即可；只有明确需要
                节流/等外部就绪的节点才设正数。
  - meeting:    chairAgentId（必填，会长）、participantNodeIds（必填，参与者节点 id 数组）
  - note:       content（必填，备注内容）、targets（注入到哪些 agent 节点 id）
  - human-gate: 无专属字段（纯暂停点）
  - output:     无专属字段

  edges 字段：
  - 每条边：{ "source": "起点节点id", "target": "终点节点id" }
  - 所有边合起来必须构成 DAG（无环）

  调用示例:
  <action tool="create_workflow">{"params":"{\\"name\\":\\"示例\\",\\"nodes\\":[{\\"id\\":\\"entry\\",\\"type\\":\\"entry\\",\\"label\\":\\"入口\\"},{\\"id\\":\\"planner\\",\\"type\\":\\"agent\\",\\"label\\":\\"规划者\\",\\"agentId\\":\\"agent-xxx\\",\\"role\\":\\"拆解任务为子步骤\\"},{\\"id\\":\\"out\\",\\"type\\":\\"output\\",\\"label\\":\\"输出\\"}],\\"edges\\":[{\\"source\\":\\"entry\\",\\"target\\":\\"planner\\"},{\\"source\\":\\"planner\\",\\"target\\":\\"out\\"}]}"}</action>

  注意：
  - 必须先 list_agents 确认 agentId 真实存在
  - participantNodeIds 填的是同工作流内 agent 节点的 id，不是 agentId
  - label 必须体现节点职责，与你在 ask 中向用户展示的角色名保持一致
  - 不要设计回边/循环（会被校验拒绝），也不要假设 human-gate 能分叉或打回
  - 如果返回错误，根据错误信息修正后重新调用，不要放弃

### list_workflows
  描述: 查看已有工作流。不传参=列出全部（id/名称/节点数）；传 workflowId=返回该工作流完整结构。
  参数:
    workflowId: string [可选] — 要查看详情的工作流 id
  调用示例:
  <action tool="list_workflows">{}</action>
  <action tool="list_workflows">{"workflowId":"wf-xxxxx"}</action>

### update_workflow
  描述: 修改已有工作流（整图替换）。
  **仅当用户明确要求修改某个工作流、或编辑其节点内容时才使用。** 修改前务必先向用户确认改动方案（用 ask 展示将如何调整），用户同意后再调用本工具。
  参数:
    workflowId: string [必填] — 要修改的工作流 id（必须已存在，不会新建）
    params: string [必填] — 完整的 name/nodes/edges JSON（整图替换，非增量；未改动的节点也要原样带上）
  使用流程:
  1. 先调 list_workflows 拿到该工作流的完整当前结构
  2. 在其基础上做用户要求的改动，构造完整的新 nodes/edges
  3. 调 update_workflow 提交（校验不过则原图不动，按错误修正后重试）
  注意:
  - 节点/边的字段规则与 create_workflow 完全一致（同样必须是 DAG、Entry 必存、Output 唯一）
  - 用户手工调整的画布布局会自动保留（按节点 id 沿用坐标），无需关心 position
  调用示例:
  <action tool="update_workflow">{"workflowId":"wf-xxxxx","params":"{\\"name\\":\\"...\\",\\"nodes\\":[...],\\"edges\\":[...]}"}</action>`;
}
