import { createHash } from 'node:crypto';
import { frameworkError } from '../shared/framework-error.js';

export interface RecordPageBudget {
  maxTextChars: number;
  maxTextLines: number;
}

export interface RecordPage {
  text: string;
  nextCursor?: string;
  truncated: boolean;
}

export function pageRecord(
  key: string, value: unknown, cursor: string | undefined, budget: RecordPageBudget,
): RecordPage {
  const text = JSON.stringify(value, null, 2);
  if (typeof text !== 'string') throw pageError('RECORD_CONTENT_INVALID', '运行记录内容无效');
  const hash = createHash('sha256').update(key).update('\0').update(text).digest('hex');
  const offset = cursor ? decodeCursor(cursor, hash) : 0;
  if (offset > text.length) throw pageError('RECORD_CURSOR_STALE', '运行记录游标已失效');
  const maxChars = Math.max(1, Math.min(budget.maxTextChars, 12_000));
  const maxLines = Math.max(1, Math.min(budget.maxTextLines, 200));
  let end = offset;
  let lines = 1;
  while (end < text.length && end - offset < maxChars) {
    if (text[end] === '\n' && lines >= maxLines && end > offset) break;
    if (text[end] === '\n') lines += 1;
    end += 1;
  }
  const truncated = end < text.length;
  return { text: text.slice(offset, end), truncated,
    ...(truncated ? { nextCursor: Buffer.from(JSON.stringify({ hash, offset: end }))
      .toString('base64url') } : {}) };
}

function decodeCursor(cursor: string, hash: string): number {
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new Error('format');
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      hash?: unknown; offset?: unknown;
    };
    if (value.hash !== hash || !Number.isSafeInteger(value.offset)
      || (value.offset as number) < 0) throw new Error('stale');
    return value.offset as number;
  } catch {
    throw pageError('RECORD_CURSOR_STALE', '运行记录游标已失效');
  }
}

function pageError(code: string, message: string) {
  return frameworkError({ code, kind: 'validation', message,
    source: 'collaboration.record-page', retryable: false });
}
