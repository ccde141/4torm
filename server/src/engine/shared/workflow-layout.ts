/**
 * 工作流自动布局（从左到右）
 *
 * 拓扑排序后逐层分配 x 坐标（左→右推进），
 * 同层节点垂直分布（上下平行排列）。
 * 生成的坐标可在画布上手动微调。
 */

import type { AINode, AIEdge } from './workflow-builder';

// ── 常量 ──────────────────────────────────────────────────────────

/** 层间水平间距（左→右推进方向） */
const LAYER_GAP_X = 350;
/** 同层节点垂直间距 */
const NODE_GAP_Y = 200;
/** 起始坐标 */
const BASE_X = 1200;
const BASE_Y = 1100;

// ── 自动布局入口 ──────────────────────────────────────────────────

/**
 * 根据 DAG 拓扑排序，从左到右分层布局。
 * 同一层（同级分支）垂直平行排列。
 * 返回 Map<nodeId, {x, y}>。
 */
export function autoLayout(
  nodes: AINode[],
  edges: AIEdge[],
): Map<string, { x: number; y: number }> {
  const layers = assignLayers(nodes, edges);
  const positions = new Map<string, { x: number; y: number }>();

  // 按层号分组
  const layerGroups = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(id);
  }

  // 逐层分配坐标：x 按层递增（左→右），y 按同层内节点垂直居中分布
  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);
  for (const layerIdx of sortedLayers) {
    const group = layerGroups.get(layerIdx)!;
    const x = BASE_X + layerIdx * LAYER_GAP_X;
    const totalHeight = (group.length - 1) * NODE_GAP_Y;
    const startY = BASE_Y - totalHeight / 2;
    for (let i = 0; i < group.length; i++) {
      positions.set(group[i], { x, y: startY + i * NODE_GAP_Y });
    }
  }

  return positions;
}

// ── 拓扑排序分层（Kahn's algorithm） ────────────────────────────

function assignLayers(
  nodes: AINode[],
  edges: AIEdge[],
): Map<string, number> {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
  }

  const layers = new Map<string, number>();
  const queue: string[] = [];

  // 入度为 0 的节点在第 0 层（最左）
  for (const n of nodes) {
    if ((inDegree.get(n.id) || 0) === 0) {
      queue.push(n.id);
      layers.set(n.id, 0);
    }
  }

  // BFS 分层（取最大层号保证节点尽可能靠右）
  while (queue.length > 0) {
    const u = queue.shift()!;
    const uLayer = layers.get(u) || 0;
    for (const v of adj.get(u) || []) {
      const newLayer = uLayer + 1;
      if (!layers.has(v) || layers.get(v)! < newLayer) {
        layers.set(v, newLayer);
      }
      inDegree.set(v, (inDegree.get(v) || 0) - 1);
      if (inDegree.get(v) === 0) {
        queue.push(v);
      }
    }
  }

  // 孤立节点放第 0 层
  for (const n of nodes) {
    if (!layers.has(n.id)) layers.set(n.id, 0);
  }

  return layers;
}
