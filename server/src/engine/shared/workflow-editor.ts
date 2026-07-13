/**
 * 工作流查看 / 修改假工具 — 执行器
 *
 * list_workflows / update_workflow 的实现，复用 workflow-builder 的解析、校验、构图逻辑。
 * 由季风 session-runner 的 toolCaller 拦截后调用。
 *
 * 设计要点：
 * - update 为「整图替换」：AI 提交完整 nodes/edges，覆盖原图（先 list 拿全图再改）
 * - 校验不过绝不写盘（防把好工作流改坏）
 * - 保留原节点坐标：按 id 沿用 position，仅新增节点 autoLayout（不冲掉用户手调排版）
 * - 「改前问人类」纯靠提示词约束，本工具调用即写盘，不走 ask/挂起
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from './atomic-io';
import { extractParams, buildGraphFromParams, type GraphNode } from './workflow-builder';
import { validateWorkflow } from './workflow-validator';

interface GraphFile {
  nodes: GraphNode[];
  edges: Array<{ id: string; source: string; sourcePort: number; target: string; targetPort: number; kind: string }>;
}

function workflowsDir(dataDir: string): string {
  return path.join(dataDir, 'tradewind', 'workflows');
}

// ── list_workflows ────────────────────────────────────────────────

/**
 * 列出所有工作流，或返回指定工作流的完整结构（AI 友好格式，剥掉画布坐标）。
 * args.workflowId 存在 → 返回该图详情；否则 → 返回列表。
 */
export async function execListWorkflows(dataDir: string, args: Record<string, unknown>): Promise<string> {
  const wfRoot = workflowsDir(dataDir);
  const id = args.workflowId ? String(args.workflowId) : '';

  if (id) {
    try {
      const graphRaw = await fs.readFile(path.join(wfRoot, id, 'graph.json'), 'utf-8');
      const metaRaw = await fs.readFile(path.join(wfRoot, id, 'meta.json'), 'utf-8').catch(() => '{}');
      const graph = JSON.parse(graphRaw) as GraphFile;
      const meta = JSON.parse(metaRaw) as { name?: string };
      // note 边（kind==='note'）还原为源 note 节点的 targets 字段，使输出格式与
      // update_workflow 的输入（AINode）对齐——否则 AI 改图时会丢失 note 连接。
      const noteTargets = new Map<string, string[]>();
      for (const e of graph.edges) {
        if (e.kind === 'note') {
          const arr = noteTargets.get(e.source) ?? [];
          arr.push(e.target);
          noteTargets.set(e.source, arr);
        }
      }
      // 剥掉 position 等画布噪声，只给 AI 看结构
      const view = {
        workflowId: id,
        name: meta.name ?? id,
        nodes: graph.nodes.map(n => ({
          id: n.id, type: n.type, label: n.label, ...n.config,
          ...(noteTargets.has(n.id) ? { targets: noteTargets.get(n.id) } : {}),
        })),
        edges: graph.edges.filter(e => e.kind === 'handoff').map(e => ({ source: e.source, target: e.target })),
      };
      return JSON.stringify(view, null, 2);
    } catch (e) {
      return `读取工作流「${id}」失败：${(e as Error).message}（确认 workflowId 是否正确）`;
    }
  }

  // 列表模式
  try {
    const entries = await fs.readdir(wfRoot, { withFileTypes: true });
    const list: Array<{ workflowId: string; name: string; nodeCount: number; updatedAt: string }> = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      try {
        const metaRaw = await fs.readFile(path.join(wfRoot, ent.name, 'meta.json'), 'utf-8');
        const graphRaw = await fs.readFile(path.join(wfRoot, ent.name, 'graph.json'), 'utf-8');
        const meta = JSON.parse(metaRaw) as { name?: string; updatedAt?: string };
        const graph = JSON.parse(graphRaw) as GraphFile;
        list.push({
          workflowId: ent.name,
          name: meta.name ?? ent.name,
          nodeCount: graph.nodes.length,
          updatedAt: meta.updatedAt ?? '',
        });
      } catch { /* 跳过损坏/不完整的工作流目录 */ }
    }
    if (list.length === 0) return '当前没有已创建的工作流。';
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return JSON.stringify(list, null, 2);
  } catch (e) {
    return `读取工作流目录失败：${(e as Error).message}`;
  }
}

// ── update_workflow ───────────────────────────────────────────────

/**
 * 整图替换更新工作流。校验不过不写盘；保留原节点坐标。
 */
export async function execUpdateWorkflow(dataDir: string, args: Record<string, unknown>): Promise<string> {
  const workflowId = args.workflowId ? String(args.workflowId) : '';
  if (!workflowId) {
    return '更新失败：缺少 workflowId。请先用 list_workflows 查看可用工作流及其 id。';
  }

  const wfDir = path.join(workflowsDir(dataDir), workflowId);

  // 1. 确认工作流存在（不存在则报错，绝不新建）
  let originalGraph: GraphFile;
  try {
    const raw = await fs.readFile(path.join(wfDir, 'graph.json'), 'utf-8');
    originalGraph = JSON.parse(raw) as GraphFile;
  } catch {
    return `更新失败：工作流「${workflowId}」不存在或已损坏。请用 list_workflows 确认 id。`;
  }

  // 2. 解析新图参数（复用 create 的健壮解析）
  const parsed = extractParams(args);
  if (typeof parsed === 'string') return parsed.replace('参数错误', '更新失败');
  const params = parsed;

  if (!params.name || !Array.isArray(params.nodes) || !Array.isArray(params.edges)) {
    return '更新失败：缺少必填字段 name / nodes / edges，或 nodes/edges 不是数组。';
  }

  // 2.5 归一化 edges（兼容 from/to）
  params.edges = params.edges.map(e => {
    const raw = e as unknown as Record<string, unknown>;
    return { source: (raw.source || raw.from || '') as string, target: (raw.target || raw.to || '') as string };
  });

  // 3. 加载 agent 注册表供校验
  let agentIds: Set<string>;
  try {
    const raw = await fs.readFile(path.join(dataDir, 'agents', 'registry.json'), 'utf-8');
    agentIds = new Set(Object.keys(JSON.parse(raw)));
  } catch {
    return '更新失败：无法读取 agent 注册表。';
  }

  // 4. 强校验（不过绝不写盘）
  const errors = validateWorkflow(params, agentIds);
  if (errors.length > 0) {
    const lines = errors.map((e, i) => `${i + 1}. ${e.message}`);
    return `更新失败，发现以下问题（原工作流未改动）：\n${lines.join('\n')}\n\n请修正参数后重新调用 update_workflow。`;
  }

  // 5. 保留原节点坐标（按 id 沿用），仅新增节点 autoLayout
  const existingPositions = new Map(originalGraph.nodes.map(n => [n.id, n.position]));
  const graph = buildGraphFromParams(params, existingPositions);

  // 6. 写回（覆盖 graph.json，更新 meta.updatedAt + name）
  try {
    await atomicWriteFile(path.join(wfDir, 'graph.json'), JSON.stringify(graph, null, 2));
    const metaPath = path.join(wfDir, 'meta.json');
    let meta: Record<string, unknown> = { workflowId };
    try { meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')); } catch { /* meta 缺失则重建 */ }
    meta.name = params.name;
    meta.updatedAt = new Date().toISOString();
    await atomicWriteFile(metaPath, JSON.stringify(meta, null, 2));
  } catch (e) {
    return `更新失败：写入文件时出错 — ${(e as Error).message}`;
  }

  return `工作流「${params.name}」（${workflowId}）已更新：${graph.nodes.length} 个节点。可在信风画布查看。`;
}
