import { FrameworkError } from '../shared/framework-error.js';
import { throwForReActFailure, type ReActTermination } from '../shared/react/outcome.js';

export function resolveConvectionContent(
  content: string,
  termination: ReActTermination,
): string | undefined {
  throwForReActFailure(termination);
  if (termination.status === 'aborted') return undefined;
  if (termination.status === 'waiting') {
    throw new FrameworkError({
      code: 'CONVECTION_WAITING_UNSUPPORTED', kind: 'protocol',
      message: '对流参与者进入了不受支持的等待状态',
      source: 'convection.participant', retryable: false,
    });
  }
  const clean = content.trim();
  if (!clean) {
    throw new FrameworkError({
      code: 'MODEL_EMPTY_RESPONSE', kind: 'protocol', message: '模型返回空响应',
      source: 'convection.participant', retryable: false,
    });
  }
  return clean;
}
