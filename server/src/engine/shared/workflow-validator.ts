/**
 * 工作流校验器
 *
 * 对 AI 提交的 create_workflow 参数做全量校验。
 * 收集所有错误一次性返回（不是遇到第一个就停）。
 */

import type { AINode, AIEdge, CreateWorkflowParams } from './workflow-builder';

// ── 类型 ──────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

// ── 校验入口 ──────────────────────────────────────────────────────

export function validateWorkflow(
  params: CreateWorkflowParams,
  validAgentIds: Set<string>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const nodeIds = new Set<string>();
  const nodeMap = new Map<string, AINode>();

  // ① 节点 id 唯一性
  for (const n of params.nodes) {
    if (nodeIds.has(n.id)) {
      errors.push({ field: `nodes.${n.id}`, message: `节点 id 重复：${n.id}` });
    }
    nodeIds.add(n.id);
    nodeMap.set(n.id, n);
  }

  // ② entry / output 存在性
  const entries = params.nodes.filter(n => n.type === 'entry');
  const outputs = params.nodes.filter(n => n.type === 'output');
  if (entries.length === 0) {
    errors.push({ field: 'nodes', message: '缺少 entry 节点' });
  }
  if (outputs.length === 0) {
    errors.push({ field: 'nodes', message: '缺少 output 节点' });
  }
  if (outputs.length > 1) {
    errors.push({ field: 'nodes', message: `output 节点只能有一个，当前有 ${outputs.length} 个` });
  }

  // ②.5 label 质量校验（agent/meeting 必须有人类可读的名字，不能是占位）
  const placeholderLabels = new Set(['agent', 'meeting', 'agent节点', '会议室', '节点', 'node']);
  for (const n of params.nodes) {
    if (n.type === 'agent' || n.type === 'meeting') {
      const label = (n.label || '').trim();
      if (!label) {
        errors.push({
          field: `nodes.${n.id}.label`,
          message: `${n.type === 'agent' ? 'agent' : '会议'}节点「${n.id}」缺少 label，必须填写人类可读的角色名（如"规划者"、"代码审校"）`,
        });
      } else if (placeholderLabels.has(label.toLowerCase())) {
        errors.push({
          field: `nodes.${n.id}.label`,
          message: `节点「${n.id}」的 label「${label}」是无意义占位名，请填写体现该节点职责的具体名称`,
        });
      }
    }
  }

  // ③ agent 节点的 agentId 合法性
  for (const n of params.nodes) {
    if (n.type === 'agent') {
      if (!n.agentId) {
        errors.push({ field: `nodes.${n.id}`, message: `agent 节点「${n.id}」缺少 agentId` });
      } else if (!validAgentIds.has(n.agentId)) {
        errors.push({
          field: `nodes.${n.id}.agentId`,
          message: `agent 节点「${n.id}」引用的 agentId「${n.agentId}」不存在`,
        });
      }
    }
  }

  // ④ meeting 节点校验
  for (const n of params.nodes) {
    if (n.type === 'meeting') {
      if (!n.chairAgentId) {
        errors.push({ field: `nodes.${n.id}`, message: `会议「${n.id}」缺少 chairAgentId` });
      } else if (!validAgentIds.has(n.chairAgentId)) {
        errors.push({
          field: `nodes.${n.id}.chairAgentId`,
          message: `会议「${n.id}」的会长 agentId「${n.chairAgentId}」不存在`,
        });
      }
      if (!n.participantNodeIds || n.participantNodeIds.length === 0) {
        errors.push({ field: `nodes.${n.id}`, message: `会议「${n.id}」至少需要一个参与者` });
      } else {
        for (const p of n.participantNodeIds) {
          if (!nodeIds.has(p)) {
            errors.push({
              field: `nodes.${n.id}.participantNodeIds`,
              message: `会议「${n.id}」的参与者「${p}」不在节点列表中`,
            });
          } else {
            const pNode = nodeMap.get(p);
            if (pNode && pNode.type !== 'agent') {
              errors.push({
                field: `nodes.${n.id}.participantNodeIds`,
                message: `会议「${n.id}」的参与者「${p}」不是 agent 节点`,
              });
            }
          }
        }
      }
    }
  }

  // ⑤ note 节点的 targets 校验
  for (const n of params.nodes) {
    if (n.type === 'note' && n.targets) {
      for (const t of n.targets) {
        if (!nodeIds.has(t)) {
          errors.push({
            field: `nodes.${n.id}.targets`,
            message: `备注「${n.id}」的 targets「${t}」不在节点列表中`,
          });
        }
      }
    }
  }

  // ⑥ edges 引用合法性
  for (const e of params.edges) {
    if (!nodeIds.has(e.source)) {
      errors.push({ field: 'edges', message: `边 source「${e.source}」不在节点列表中` });
    }
    if (!nodeIds.has(e.target)) {
      errors.push({ field: 'edges', message: `边 target「${e.target}」不在节点列表中` });
    }
  }

  // ⑦ DAG 检测（环路）
  const cycle = detectCycle(params.nodes, params.edges);
  if (cycle) {
    errors.push({
      field: 'edges',
      message: `存在环路（${cycle.join(' → ')}），工作流必须为 DAG`,
    });
  }

  return errors;
}

// ── DAG 环路检测（DFS） ────────────────────────────────────────────

function detectCycle(nodes: AINode[], edges: AIEdge[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    const list = adj.get(e.source);
    if (list) list.push(e.target);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  const parent = new Map<string, string>();

  for (const n of nodes) {
    if (color.get(n.id) === WHITE) {
      const cycle = dfs(n.id, adj, color, parent);
      if (cycle) return cycle;
    }
  }
  return null;
}

function dfs(
  u: string,
  adj: Map<string, string[]>,
  color: Map<string, number>,
  parent: Map<string, string>,
): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  color.set(u, GRAY);
  for (const v of adj.get(u) || []) {
    if (color.get(v) === GRAY) {
      // 回溯构造环路径
      const cycle = [v, u];
      let cur = u;
      while (cur !== v && parent.has(cur)) {
        cur = parent.get(cur)!;
        if (cur === v) break;
        cycle.push(cur);
      }
      cycle.push(v);
      return cycle.reverse();
    }
    if (color.get(v) === WHITE) {
      parent.set(v, u);
      const cycle = dfs(v, adj, color, parent);
      if (cycle) return cycle;
    }
  }
  color.set(u, BLACK);
  return null;
}
