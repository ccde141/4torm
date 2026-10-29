import { FrameworkError } from '../framework-error.js';

export class CompactionNoGainError extends FrameworkError {
  constructor() {
    super({ code: 'COMPACTION_DID_NOT_REDUCE', kind: 'provider',
      message: '压缩结果未减少上下文体量，原文及近期会话已保留', source: 'compaction', retryable: false });
  }
}
