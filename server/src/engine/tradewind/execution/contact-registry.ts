/**
 * Contact Registry —— 跨节点横向联络的全局注册表 + 死锁防护
 *
 * 职责：
 * 1. 维护 label → nodeId 的查找索引（启动时由 orchestrator 注入）
 * 2. 维护有向等待图（nodeId → 正在等待的 targetNodeId）
 * 3. 发起 contact 前检测环（DFS），拒绝会造成死锁的调用
 * 4. contact 完成后清除等待关系
 *
 * 设计约束：
 * - 全局单例（一个进程同时只有一个工作流在跑）
 * - 等待图是稀疏的（同一时刻一个节点最多等一个目标）
 * - 环检测 O(n)，n = agent 节点数，通常 < 20
 */

import type { NodeRunner } from './node-runner';

// ── 全局状态 ──────────────────────────────────────────────────────

/** label → nodeId */
const labelIndex = new Map<string, string>();

/** nodeId → NodeRunner（引用 agent.ts 的 activeNodeRunners） */
let runnerLookup: Map<string, NodeRunner> | null = null;

/** 有向等待图：sourceNodeId → targetNodeId（source 正在等 target 回复） */
const waitGraph = new Map<string, string>();

// ── 初始化 / 清理 ────────────────────────────────────────────────

/** 工作流启动时注入 label→nodeId 映射 + runner 查找表引用 */
export function initContactRegistry(
  nodeLabelMap: Record<string, string>,
  runners: Map<string, NodeRunner>,
): void {
  labelIndex.clear();
  waitGraph.clear();
  for (const [nodeId, label] of Object.entries(nodeLabelMap)) {
    labelIndex.set(label, nodeId);
  }
  runnerLookup = runners;
}

/** 工作流停止时清理 */
export function clearContactRegistry(): void {
  labelIndex.clear();
  waitGraph.clear();
  runnerLookup = null;
}

// ── 查找 ─────────────────────────────────────────────────────────

/** 通过 label 查找目标节点的 NodeRunner，找不到返回 null */
export function findRunnerByLabel(label: string): { nodeId: string; runner: NodeRunner } | null {
  const nodeId = labelIndex.get(label);
  if (!nodeId) return null;
  const runner = runnerLookup?.get(nodeId) ?? null;
  if (!runner) return null;
  return { nodeId, runner };
}

// ── 等待图管理 + 环检测 ──────────────────────────────────────────

/**
 * 尝试注册一条等待关系：source 即将等待 target 回复。
 * 如果注册后会形成环（死锁），返回 false 并不注册。
 * 成功注册返回 true。
 */
export function tryRegisterWait(sourceNodeId: string, targetNodeId: string): boolean {
  // 检测：从 target 出发沿 waitGraph 走，能否走回 source
  if (wouldFormCycle(sourceNodeId, targetNodeId)) {
    return false;
  }
  waitGraph.set(sourceNodeId, targetNodeId);
  return true;
}

/** contact 完成后清除等待关系 */
export function clearWait(sourceNodeId: string): void {
  waitGraph.delete(sourceNodeId);
}

/**
 * 环检测：如果在 waitGraph 中加入 source→target 后会形成环，返回 true。
 * 算法：从 target 开始，沿现有 waitGraph 边做 DFS，看能否到达 source。
 */
function wouldFormCycle(sourceNodeId: string, targetNodeId: string): boolean {
  let current: string | undefined = targetNodeId;
  const visited = new Set<string>();
  while (current) {
    if (current === sourceNodeId) return true;
    if (visited.has(current)) return false; // 已经成环但不含 source
    visited.add(current);
    current = waitGraph.get(current);
  }
  return false;
}
