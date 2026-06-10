/**
 * 工作流图校验器
 *
 * 入口：
 *   validateWorkflow(graph, dataDir, knownNodeTypes)
 *     → Promise<ValidationError[]>
 *
 * 出口：
 *   空数组 = 校验通过
 *   ValidationError[] = {code, message, nodeId?, edgeId?} 列表
 *
 * 校验规则（每条规则一个独立函数，删除/禁用一条 = 注释主函数中的一行）：
 *   R1  checkNodeIdUnique          — 节点 ID 唯一
 *   R2  checkNodeLabelUnique       — 节点 label 必填且唯一
 *   R3  checkNodeTypeRegistered    — 节点类型必须已注册
 *   R4  checkAgentNodeConfig       — Agent 节点 agentId + maxSubAgents
 *   R5  checkAgentExists           — agentId 必须存在于 registry.json
 *   R6  checkSingleOutput          — 有且仅有 1 个 Output 节点
 *   R7  checkEdgeRefs              — 边的 source/target 指向真实节点
 *   R8  checkEntryExists           — 至少 1 个 Entry 节点
 *   R9  checkEntryNoInput          — Entry 节点无 work 入线
 *   R10 checkOutputNoOutput        — Output 节点无出线
 *   R11 checkNonEntryHasInput      — 非 Entry/Note 节点必须有至少 1 条 work 入线
 *   R12 checkNoteEdges             — note 边规则（source=note, target=agent）
 *   R13 checkReworkEdges           — rework 边规则（封存中，启封时启用）
 *   R14 checkNoCycles              — handoff 子图无环（rework 边不参与）
 *   R15 checkNoteNodeIO            — Note 节点不能有 handoff 入/出线
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowGraph, WorkflowEdge, WorkflowNode } from './types';

export interface ValidationError {
  code: string;
  message: string;
  /** 出错节点 ID，前端可据此高亮 */
  nodeId?: string;
  /** 出错连线 ID，前端可据此高亮 */
  edgeId?: string;
}

/** 派生数据上下文，buildContext 一次构建给所有规则使用 */
interface ValidationContext {
  graph: WorkflowGraph;
  knownNodeTypes: Set<string>;
  knownAgentIds: Set<string>;
  nodeById: Map<string, WorkflowNode>;
  /** target → handoff 入线列表 */
  handoffInEdges: Map<string, WorkflowEdge[]>;
  /** source → handoff 出线列表 */
  handoffOutEdges: Map<string, WorkflowEdge[]>;
}

type ValidationRule = (ctx: ValidationContext) => ValidationError[];

// ── 主函数 ────────────────────────────────────────────────────────

export async function validateWorkflow(
  graph: WorkflowGraph,
  dataDir: string,
  knownNodeTypes: Set<string>,
): Promise<ValidationError[]> {
  const ctx = await buildContext(graph, dataDir, knownNodeTypes);

  // 规则按依赖顺序排列：先基础（节点/边引用），再拓扑（Entry/Output），再边语义（note/rework）
  const rules: ValidationRule[] = [
    checkNodeIdUnique,           // R1
    checkNodeLabelUnique,        // R2
    checkNodeTypeRegistered,     // R3
    checkAgentNodeConfig,        // R4
    checkAgentExists,            // R5
    checkSingleOutput,           // R6
    checkEdgeRefs,               // R7
    checkEntryExists,            // R8
    checkEntryNoInput,           // R9
    checkOutputNoOutput,         // R10
    checkNonEntryHasInput,       // R11
    checkNoteEdges,              // R12
    checkReworkEdges,             // R13
    checkNoCycles,                // R14
    checkNoteNodeIO,              // R15
  ];

  return rules.flatMap(rule => rule(ctx));
}

// ── 上下文构建 ────────────────────────────────────────────────────

async function buildContext(
  graph: WorkflowGraph,
  dataDir: string,
  knownNodeTypes: Set<string>,
): Promise<ValidationContext> {
  const nodeById = new Map<string, WorkflowNode>();
  for (const n of graph.nodes) nodeById.set(n.id, n);

  const handoffInEdges = new Map<string, WorkflowEdge[]>();
  const handoffOutEdges = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) {
    if (e.kind !== 'handoff') continue;
    (handoffInEdges.get(e.target) ?? handoffInEdges.set(e.target, []).get(e.target)!).push(e);
    (handoffOutEdges.get(e.source) ?? handoffOutEdges.set(e.source, []).get(e.source)!).push(e);
  }

  return {
    graph,
    knownNodeTypes,
    knownAgentIds: await readAgentIdSet(dataDir),
    nodeById,
    handoffInEdges,
    handoffOutEdges,
  };
}

/** 读 Agent registry 用于 agentId 存在性检查；失败返回空表 */
async function readAgentIdSet(dataDir: string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.join(dataDir, 'agents', 'registry.json'), 'utf-8');
    const registry = JSON.parse(raw) as Record<string, unknown>;
    return new Set(Object.keys(registry));
  } catch {
    return new Set();
  }
}

// ── R1 节点 ID 唯一 ───────────────────────────────────────────────

function checkNodeIdUnique(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  for (const node of ctx.graph.nodes) {
    if (seen.has(node.id)) {
      errors.push({
        code: 'duplicate-node-id',
        message: `节点 ID 重复：${node.id}`,
        nodeId: node.id,
      });
    }
    seen.add(node.id);
  }
  return errors;
}

// ── R2 节点 label 必填且唯一 ──────────────────────────────────────

function checkNodeLabelUnique(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  // 只对参与对话的节点类型强制 label 唯一（agent、meeting）
  // entry、output、note 允许同名——它们不出现在消息标识中
  const requireUnique = new Set(['agent', 'meeting']);
  const seen = new Map<string, string>();  // label → 首次出现的 nodeId
  for (const node of ctx.graph.nodes) {
    if (!node.label || typeof node.label !== 'string') {
      errors.push({
        code: 'missing-node-label',
        message: `节点 ${node.id} 缺少显示名，请点击节点设置一个名称`,
        nodeId: node.id,
      });
      continue;
    }
    if (!requireUnique.has(node.type)) continue;
    const prev = seen.get(node.label);
    if (prev) {
      const prevNode = ctx.nodeById.get(prev);
      const prevType = prevNode ? getTypeName(prevNode.type) : '节点';
      const curType = getTypeName(node.type);
      errors.push({
        code: 'duplicate-node-label',
        message: `存在两个名为「${node.label}」的节点（${prevType} 与 ${curType}），请给它们起不同的名称以便在对话中区分`,
        nodeId: node.id,
      });
    } else {
      seen.set(node.label, node.id);
    }
  }
  return errors;
}

// ── R3 节点类型已注册 ─────────────────────────────────────────────

function checkNodeTypeRegistered(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const node of ctx.graph.nodes) {
    // Agent 节点是 per-execution 动态构造的，type='agent' 即合法，跳过 knownTypes 检查
    if (node.type === 'agent') continue;
    if (!ctx.knownNodeTypes.has(node.type)) {
      errors.push({
        code: 'unknown-node-type',
        message: `未注册的节点类型：${node.type}（节点「${node.label || node.id}」）`,
        nodeId: node.id,
      });
    }
  }
  return errors;
}

// ── R4 Agent 节点配置 ─────────────────────────────────────────────

function checkAgentNodeConfig(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const node of ctx.graph.nodes) {
    if (node.type !== 'agent') continue;
    const cfg = node.config as { agentId?: unknown; maxSubAgents?: unknown } | undefined;
    if (!cfg || typeof cfg.agentId !== 'string' || !cfg.agentId) {
      errors.push({
        code: 'agent-node-missing-agent-id',
        message: `Agent 节点「${node.label || node.id}」未选择 Agent`,
        nodeId: node.id,
      });
    }
    if (cfg?.maxSubAgents !== undefined && cfg.maxSubAgents !== null) {
      const v = cfg.maxSubAgents;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10) {
        errors.push({
          code: 'invalid-max-sub-agents',
          message: `Agent 节点「${node.label || node.id}」的 maxSubAgents 必须为 0-10 整数（当前：${String(v)}）`,
          nodeId: node.id,
        });
      }
    }
  }
  return errors;
}

// ── R5 agentId 必须存在 ───────────────────────────────────────────

function checkAgentExists(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  if (ctx.knownAgentIds.size === 0) return errors;  // registry 读不到时跳过（避免假阳性）
  for (const node of ctx.graph.nodes) {
    if (node.type !== 'agent') continue;
    const agentId = (node.config as { agentId?: unknown } | undefined)?.agentId;
    if (typeof agentId !== 'string' || !agentId) continue;  // R4 已报错
    if (!ctx.knownAgentIds.has(agentId)) {
      errors.push({
        code: 'agent-not-found',
        message: `Agent 节点「${node.label || node.id}」引用的 Agent 不存在：${agentId}（请确认 data/agents/registry.json 中存在该 ID）`,
        nodeId: node.id,
      });
    }
  }
  return errors;
}

// ── R6 单 Output ──────────────────────────────────────────────────

function checkSingleOutput(ctx: ValidationContext): ValidationError[] {
  const outputs = ctx.graph.nodes.filter(n => n.type === 'output');
  if (outputs.length === 0) {
    return [{ code: 'no-output', message: '工作流必须包含 1 个 Output 节点（当前 0 个）' }];
  }
  if (outputs.length > 1) {
    return outputs.map(n => ({
      code: 'multiple-output',
      message: `工作流仅允许 1 个 Output 节点（当前 ${outputs.length} 个）`,
      nodeId: n.id,
    }));
  }
  return [];
}

// ── R7 边 source/target 存在 ──────────────────────────────────────

function checkEdgeRefs(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenEdgeIds = new Set<string>();
  for (const edge of ctx.graph.edges) {
    if (seenEdgeIds.has(edge.id)) {
      errors.push({ code: 'duplicate-edge-id', message: `连线 ID 重复：${edge.id}`, edgeId: edge.id });
    }
    seenEdgeIds.add(edge.id);

    if (!ctx.nodeById.has(edge.source)) {
      errors.push({
        code: 'edge-source-missing',
        message: `连线 ${edge.id} 的 source 节点不存在：${edge.source}`,
        edgeId: edge.id,
      });
    }
    if (!ctx.nodeById.has(edge.target)) {
      errors.push({
        code: 'edge-target-missing',
        message: `连线 ${edge.id} 的 target 节点不存在：${edge.target}`,
        edgeId: edge.id,
      });
    }
  }
  return errors;
}

// ── R8 至少 1 个 Entry ────────────────────────────────────────────

function checkEntryExists(ctx: ValidationContext): ValidationError[] {
  const entries = ctx.graph.nodes.filter(n => n.type === 'entry');
  if (entries.length === 0) {
    return [{ code: 'no-entry', message: '工作流必须至少包含 1 个 Entry 节点（用于启动信封流）' }];
  }
  return [];
}

// ── R9 Entry 无 work 入线 ─────────────────────────────────────────

function checkEntryNoInput(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const node of ctx.graph.nodes) {
    if (node.type !== 'entry') continue;
    const inputs = ctx.handoffInEdges.get(node.id) ?? [];
    for (const edge of inputs) {
      errors.push({
        code: 'entry-has-input',
        message: `Entry 节点「${node.label || node.id}」不能有入线（Entry 是工作流起点）`,
        nodeId: node.id,
        edgeId: edge.id,
      });
    }
  }
  return errors;
}

// ── R10 Output 无出线 ─────────────────────────────────────────────

function checkOutputNoOutput(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const node of ctx.graph.nodes) {
    if (node.type !== 'output') continue;
    const outputs = ctx.handoffOutEdges.get(node.id) ?? [];
    for (const edge of outputs) {
      errors.push({
        code: 'output-has-output',
        message: `Output 节点「${node.label || node.id}」不能有出线（Output 是工作流终点）`,
        nodeId: node.id,
        edgeId: edge.id,
      });
    }
  }
  return errors;
}

// ── R11 非 Entry/Note 节点必须有 work 入线 ───────────────────────

function checkNonEntryHasInput(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const node of ctx.graph.nodes) {
    if (node.type === 'entry' || node.type === 'note') continue;
    const inputs = ctx.handoffInEdges.get(node.id) ?? [];
    if (inputs.length === 0) {
      errors.push({
        code: 'no-input',
        message: `节点「${node.label || node.id}」无任何上游连线，将永远不会激活`,
        nodeId: node.id,
      });
    }
  }
  return errors;
}

// ── R12 Note 边规则 ───────────────────────────────────────────────

function checkNoteEdges(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const edge of ctx.graph.edges) {
    if (edge.kind !== 'note') continue;
    const sourceType = ctx.nodeById.get(edge.source)?.type;
    const targetType = ctx.nodeById.get(edge.target)?.type;
    if (sourceType && sourceType !== 'note') {
      errors.push({
        code: 'note-edge-bad-source',
        message: `连线 ${edge.id} 的 source 必须是 Note 节点（实际：${sourceType}）`,
        edgeId: edge.id,
      });
    }
    if (targetType && targetType !== 'agent') {
      errors.push({
        code: 'note-edge-bad-target',
        message: `连线 ${edge.id} 的 target 必须是 Agent 节点（实际：${targetType}）；Note 是行为修饰符，仅可挂到 Agent 上`,
        edgeId: edge.id,
      });
    }
  }
  return errors;
}

// ── R13 Rework 边规则（已废弃——Human Gate 不再使用打回机制）────────

function checkReworkEdges(_ctx: ValidationContext): ValidationError[] {
  // rework 概念已移除，此规则保留为空操作（向前兼容旧工作流文件中残留的 rework 标记）
  return [];
}

// ── R14 handoff 子图无环 ──────────────────────────────────────────
// rework 边为反向跳转，不参与环检测；纯 handoff 必须是 DAG，否则信封死循环。

function checkNoCycles(ctx: ValidationContext): ValidationError[] {
  // 邻接表（仅正向 handoff，排除 rework）
  const adj = new Map<string, string[]>();
  for (const edge of ctx.graph.edges) {
    if (edge.kind !== 'handoff') continue;
    if (edge.rework) continue;
    const arr = adj.get(edge.source) ?? [];
    arr.push(edge.target);
    adj.set(edge.source, arr);
  }

  // DFS 三色标记：white=未访问，gray=当前路径上，black=已完成
  const color = new Map<string, 'white' | 'gray' | 'black'>();
  for (const n of ctx.graph.nodes) color.set(n.id, 'white');
  const cycles: string[][] = [];      // 记录每个环的节点序列
  const reportedEdges = new Set<string>();  // 已报过的"回边"（source-target）防止平行边/多次访问重复报

  const dfs = (nodeId: string, stack: string[]): void => {
    color.set(nodeId, 'gray');
    stack.push(nodeId);
    for (const next of adj.get(nodeId) ?? []) {
      if (color.get(next) === 'gray') {
        const key = `${nodeId}->${next}`;
        if (!reportedEdges.has(key)) {
          reportedEdges.add(key);
          const idx = stack.indexOf(next);
          cycles.push([...stack.slice(idx), next]);
        }
        continue;  // 不中断，继续探查其它出线
      }
      if (color.get(next) === 'white') {
        dfs(next, stack);
      }
    }
    stack.pop();
    color.set(nodeId, 'black');
  };

  for (const node of ctx.graph.nodes) {
    if (color.get(node.id) === 'white') {
      dfs(node.id, []);
    }
  }

  // 把环节点 ID 转 label 给用户看
  return cycles.map(cycle => {
    const labels = cycle.map(id => {
      const n = ctx.nodeById.get(id);
      return n?.label || id;
    });
    return {
      code: 'cycle-detected',
      message: `检测到环：${labels.join(' → ')}（handoff 边不能形成环，否则信封会无限循环）`,
      nodeId: cycle[0],
    } as ValidationError;
  });
}

// ── R15 Note 节点不能有 handoff 入/出线 ──────────────────────────
// Note 是行为修饰符，只能通过 note 边连给 Agent。
// 即使绕过前端 onConnect（手改 JSON / 旧文件加载），后端也应拦住。

function checkNoteNodeIO(ctx: ValidationContext): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const node of ctx.graph.nodes) {
    if (node.type !== 'note') continue;
    for (const edge of ctx.handoffInEdges.get(node.id) ?? []) {
      errors.push({
        code: 'note-has-handoff-input',
        message: `Note 节点「${node.label || node.id}」不能有 handoff 入线（Note 是行为修饰符，只接收文本配置）`,
        nodeId: node.id,
        edgeId: edge.id,
      });
    }
    for (const edge of ctx.handoffOutEdges.get(node.id) ?? []) {
      errors.push({
        code: 'note-has-handoff-output',
        message: `Note 节点「${node.label || node.id}」不能有 handoff 出线（Note 只能通过 note 边连接到 Agent）`,
        nodeId: node.id,
        edgeId: edge.id,
      });
    }
  }
  return errors;
}

// ── 辅助 ──────────────────────────────────────────────────────────

function getTypeName(type: string): string {
  const map: Record<string, string> = {
    entry: '入口', output: '出口', agent: 'Agent',
    meeting: '会议室', note: 'Note', 'human-gate': '暂停点',
  };
  return map[type] ?? type;
}
