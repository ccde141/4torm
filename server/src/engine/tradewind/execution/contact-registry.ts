/** Labels and wait edges belong to one execution; another workflow cannot replace them. */
import type { NodeRunner } from './node-runner';
import { executionIdentityRequired } from './execution-registry';

interface RunnerLookup { get(nodeId: string, executionId?: string): NodeRunner | undefined }
interface ContactScope {
  labels: Map<string, string>;
  waits: Map<string, string>;
  runners: RunnerLookup | null;
}
const scopes = new Map<string, ContactScope>();
const legacyScope = '__legacy__';

export function initContactRegistry(
  nodeLabelMap: Record<string, string>, runners: RunnerLookup, executionId = legacyScope,
): void {
  scopes.set(executionId, { labels: new Map(Object.entries(nodeLabelMap).map(([id, label]) => [label, id])),
    waits: new Map(), runners });
}

export function clearContactRegistry(executionId?: string): void {
  if (executionId === undefined) scopes.clear();
  else scopes.delete(executionId);
}

function scopeFor(executionId?: string): ContactScope | undefined {
  if (executionId !== undefined) return scopes.get(executionId);
  if (scopes.size > 1) throw executionIdentityRequired();
  return scopes.values().next().value;
}

export function findRunnerByLabel(label: string, executionId?: string): { nodeId: string; runner: NodeRunner } | null {
  const scope = scopeFor(executionId);
  const nodeId = scope?.labels.get(label);
  if (!nodeId) return null;
  const runner = scope?.runners?.get(nodeId, executionId);
  return runner ? { nodeId, runner } : null;
}

export function tryRegisterWait(sourceNodeId: string, targetNodeId: string, executionId?: string): boolean {
  let scope = scopeFor(executionId);
  if (!scope) {
    scope = { labels: new Map(), waits: new Map(), runners: null };
    scopes.set(executionId ?? legacyScope, scope);
  }
  let current: string | undefined = targetNodeId;
  const visited = new Set<string>();
  while (current) {
    if (current === sourceNodeId) return false;
    if (visited.has(current)) break;
    visited.add(current);
    current = scope.waits.get(current);
  }
  scope.waits.set(sourceNodeId, targetNodeId);
  return true;
}

export function clearWait(sourceNodeId: string, executionId?: string): void {
  scopeFor(executionId)?.waits.delete(sourceNodeId);
}
