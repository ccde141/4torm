import { FrameworkError } from '../shared/framework-error.js';
import {
  throwForReActFailure,
  type ReActTermination,
} from '../shared/react/outcome.js';

export function resolveConversationTermination(
  termination: ReActTermination,
): 'succeeded' | 'aborted' {
  throwForReActFailure(termination);
  if (termination.status === 'waiting') {
    throw new FrameworkError({
      code: 'CONVERSATION_WAITING_STATE_MISSING',
      kind: 'protocol',
      message: '会话等待状态不完整',
      source: 'conversation.runner',
      retryable: false,
    });
  }
  if (termination.status === 'succeeded' || termination.status === 'aborted') {
    return termination.status;
  }
  throw new FrameworkError({
    code: 'CONVERSATION_TERMINATION_INVALID', kind: 'internal',
    message: '会话终态无效', source: 'conversation.runner', retryable: false,
  });
}
