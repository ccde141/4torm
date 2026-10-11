import { belongsToExecution, type ExecutionIdentity } from '../hooks/execution-visibility';

export class PanelIdentityError extends Error {
  constructor() {
    super('信风面板运行身份不匹配');
    this.name = 'PanelIdentityError';
  }
}

export function acceptsPanelEvent(
  value: { scope?: unknown; type?: unknown; workflowId?: unknown; executionId?: unknown },
  scope: 'agent' | 'meeting', identity: ExecutionIdentity,
): boolean {
  if (value.type === 'transport-disconnected' || value.type === 'transport-reconnected') return true;
  return value.scope === scope && belongsToExecution(value, identity);
}

export function requirePanelIdentity<T extends { workflowId?: unknown; executionId?: unknown }>(
  value: T, identity: ExecutionIdentity,
): T {
  if (!belongsToExecution(value, identity)) throw new PanelIdentityError();
  return value;
}
