import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { frameworkError } from '../../../engine/shared/framework-error.js';

export interface ArchiveFailureFact {
  errorCode: 'TRADEWIND_ARCHIVE_WRITE_FAILED';
  errorMessage: string;
  endTime?: string;
}

/** meta 无法提交时，以本次执行已落盘的终态失败事件补齐事实，而不依赖当前运行槽。 */
export async function readArchiveFailureFact(
  runDir: string, metaStatus: unknown,
): Promise<ArchiveFailureFact | undefined> {
  // 显式后续提交成功的 done/stopped/error 仍以 meta 为准；重启后的 crashed 保留失败原因。
  if (metaStatus !== 'running' && metaStatus !== 'crashed') return undefined;
  const file = path.join(runDir, 'events.jsonl');
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw factError('信风事件日志文件类型无效');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const stream = createReadStream(file, { encoding: 'utf8' });
  let failure: ArchiveFailureFact | undefined;
  let pending = '';
  try {
    for await (const chunk of stream) {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) failure = failureFromEvent(parseEvent(line)) ?? failure;
      }
    }
    // append 中途可见的尾片尚未完成持久化，不能将半个事件当作事实或损坏。
  } finally { stream.destroy(); }
  return failure;
}

function failureFromEvent(event: unknown): ArchiveFailureFact | undefined {
  if (!record(event) || event.eventTypeId !== 'node-error' || !record(event.payload)
    || event.payload.code !== 'TRADEWIND_ARCHIVE_WRITE_FAILED') return undefined;
  return { errorCode: 'TRADEWIND_ARCHIVE_WRITE_FAILED',
    errorMessage: '信风终态记录未能保存，请检查运行归档；不会自动重新执行工作流',
    ...(validTime(event.timestamp) ? { endTime: event.timestamp } : {}) };
}

function parseEvent(line: string): unknown {
  try { return JSON.parse(line) as unknown; }
  catch (error) { throw factError('信风事件日志无效', error); }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function factError(message: string, cause?: unknown) {
  return frameworkError({ code: 'TRADEWIND_RECORD_CORRUPT', kind: 'io', message,
    source: 'tradewind.records', retryable: false }, cause ? { cause } : undefined);
}
