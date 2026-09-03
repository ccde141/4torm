import { FrameworkError } from '../../shared/framework-error.js';
import { throwForReActFailure, type ReActTermination } from '../../shared/react/outcome.js';

export function resolveTradewindTermination(
  termination: ReActTermination,
  autoOutcome?: 'completed' | 'anomaly',
): 'succeeded' | 'deliver-anomaly' {
  if (termination.status === 'anomaly' && autoOutcome === 'anomaly') {
    return 'deliver-anomaly';
  }
  throwForReActFailure(termination);
  if (termination.status === 'aborted') {
    const error = new Error('工作流已停止');
    error.name = 'AbortError';
    throw error;
  }
  if (termination.status === 'waiting') {
    throw new FrameworkError({
      code: 'TRADEWIND_WAITING_UNSUPPORTED', kind: 'protocol',
      message: '信风节点进入了不受支持的等待状态',
      source: 'tradewind.node', retryable: false,
    });
  }
  return 'succeeded';
}
