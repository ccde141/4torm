import path from 'node:path';
import { frameworkError } from '../../../engine/shared/framework-error.js';

export function staleState(taskId: string, runId: string) {
  return frameworkError({ code: 'TIDE_RUN_STATE_STALE', kind: 'conflict',
    message: '潮汐运行身份已经变化', source: 'tide.run-state', retryable: false,
    details: { taskId, runId } });
}

export function corruptState(file: string, cause: unknown) {
  return frameworkError({ code: 'TIDE_RUN_STATE_CORRUPT', kind: 'protocol',
    message: '潮汐运行事实损坏', source: 'tide.run-state', retryable: false,
    details: { file: path.basename(file) } }, { cause });
}

export function runtimeIoError(cause: unknown) {
  return frameworkError({ code: 'TIDE_RUN_STATE_READ_FAILED', kind: 'io',
    message: '无法读取潮汐运行事实', source: 'tide.run-state', retryable: false }, { cause });
}
