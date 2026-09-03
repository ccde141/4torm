import type { FrameworkErrorData } from '../framework-error.js';
import { FrameworkError, frameworkErrorFromUnknown } from '../framework-error.js';

export type ReActTermination =
  | { status: 'succeeded' }
  | { status: 'failed'; error: FrameworkErrorData }
  | { status: 'aborted' }
  | { status: 'waiting' }
  | { status: 'anomaly'; error: FrameworkErrorData };

export function succeededTermination(): ReActTermination {
  return { status: 'succeeded' };
}

export function waitingTermination(): ReActTermination {
  return { status: 'waiting' };
}

export function abortedTermination(): ReActTermination {
  return { status: 'aborted' };
}

export function failedTermination(error: FrameworkErrorData): ReActTermination {
  return { status: 'failed', error };
}

export function anomalyTermination(error: FrameworkErrorData): ReActTermination {
  return { status: 'anomaly', error };
}

/** 功能层消费终态时恢复真实失败；中止、等待和成功保留给各功能区决定。 */
export function throwForReActFailure(termination: ReActTermination): void {
  if (termination.status === 'failed' || termination.status === 'anomaly') {
    throw new FrameworkError(termination.error);
  }
}

export function reactError(
  error: unknown,
  fallback: FrameworkErrorData,
): FrameworkErrorData {
  const known = frameworkErrorFromUnknown(error, fallback.source);
  return known.code === 'INTERNAL_ERROR' ? fallback : known;
}

export function reactErrorData(
  code: string,
  kind: FrameworkErrorData['kind'],
  message: string,
  source: string,
): FrameworkErrorData {
  return { code, kind, message, source, retryable: false };
}
