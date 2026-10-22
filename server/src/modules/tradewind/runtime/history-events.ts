import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { RunEventInput, RunEventsInput, RunEventsPage } from '../application/history-port.js';
import { historyError, readRunMeta, record, regularFile, runDirectory, validTime } from './history-storage.js';

const MAX_SCAN = 4 * 1024 * 1024;
const MAX_LINE = 4 * 1024 * 1024;
interface Cursor { position: number; end: number; scope: string }
interface StoredEvent { timestamp: string; nodeId: string; eventTypeId: string; payload?: unknown }

/** 游标固定文件大小；分页过程中追加的事件在刷新后读取，不污染当前快照。 */
export async function readHistoryEvents(dataDir: string, input: RunEventsInput): Promise<RunEventsPage> {
  const meta = await readRunMeta(dataDir, input);
  const file = path.join(await runDirectory(dataDir, input), 'events.jsonl');
  const size = await regularFile(file);
  const scope = filterScope(input);
  const cursor = input.cursor ? decodeCursor(input.cursor, size, scope) : { position: 0, end: size, scope };
  const items: RunEventsPage['items'] = [];
  let position = cursor.position;
  for await (const line of lines(file, cursor.position, cursor.end)) {
    // 旧水位可能截在后来已补齐的事件中；终态改变不代表这个快照尾片已成为完整行。
    if (!line.complete && (meta.status === 'running' || cursor.end < size)) break;
    const event = parseEvent(line.text);
    position = line.next;
    if (!matches(event, input)) {
      if (position - cursor.position >= MAX_SCAN) break;
      continue;
    }
    const payload = event.payload === undefined ? '' : JSON.stringify(event.payload);
    items.push({ eventOffset: line.offset, timestamp: event.timestamp, nodeId: event.nodeId,
      eventTypeId: event.eventTypeId, preview: payload.slice(0, 360), hasPayload: event.payload !== undefined,
      ...routeSummary(event.payload) });
    if (items.length >= input.limit || position - cursor.position >= MAX_SCAN) break;
  }
  const more = position < cursor.end;
  // 运行中只有半条追加事件时不生成原地游标，防止客户端无限翻同一页。
  const nextCursor = more && position > cursor.position
    ? Buffer.from(JSON.stringify({ ...cursor, position })).toString('base64url') : undefined;
  return { items, ...(nextCursor ? { nextCursor } : {}), scannedToEnd: !more };
}

export async function readHistoryEvent(dataDir: string, input: RunEventInput) {
  await readRunMeta(dataDir, input);
  const file = path.join(await runDirectory(dataDir, input), 'events.jsonl');
  const size = await regularFile(file);
  if (input.eventOffset >= size) throw historyError('TRADEWIND_HISTORY_NOT_FOUND', '运行事件不存在');
  for await (const line of lines(file, input.eventOffset, size)) {
    const event = parseEvent(line.text);
    const text = event.payload === undefined ? '' : JSON.stringify(event.payload, null, 2);
    if (input.offset > text.length) throw historyError('TRADEWIND_HISTORY_INVALID_CURSOR', '事件正文偏移无效');
    const end = Math.min(text.length, input.offset + input.maxChars);
    return { text: text.slice(input.offset, end), totalChars: text.length,
      ...(end < text.length ? { nextOffset: end } : {}) };
  }
  throw historyError('TRADEWIND_HISTORY_NOT_FOUND', '运行事件不存在');
}

async function* lines(file: string, start: number, end: number) {
  const handle = await fs.open(file, 'r');
  let position = start;
  let offset = start;
  let pending = Buffer.alloc(0);
  try {
    if (start > 0) {
      const previous = Buffer.alloc(1);
      await handle.read(previous, 0, 1, start - 1);
      if (previous[0] !== 10) throw historyError('TRADEWIND_HISTORY_INVALID_CURSOR', '事件游标不在行边界');
    }
    while (position < end) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, end - position));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) throw historyError('TRADEWIND_HISTORY_CHANGED', '事件归档在读取期间已变化，请刷新');
      position += bytesRead;
      pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
      let newline = pending.indexOf(10);
      while (newline >= 0) {
        if (newline > MAX_LINE) throw oversized();
        yield { text: pending.subarray(0, newline).toString('utf8'), offset,
          next: offset + newline + 1, complete: true };
        offset += newline + 1;
        pending = pending.subarray(newline + 1);
        newline = pending.indexOf(10);
      }
      if (pending.length > MAX_LINE) throw oversized();
    }
    if (pending.length) yield { text: pending.toString('utf8'), offset, next: end, complete: false };
  } finally { await handle.close(); }
}

function parseEvent(text: string): StoredEvent {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { throw historyError('TRADEWIND_HISTORY_CORRUPT', '运行事件 JSON 无效', error); }
  if (!record(value) || !validTime(value.timestamp) || typeof value.nodeId !== 'string'
    || typeof value.eventTypeId !== 'string' || !value.eventTypeId) throw historyError(
    'TRADEWIND_HISTORY_CORRUPT', '运行事件字段无效');
  return { timestamp: value.timestamp, nodeId: value.nodeId, eventTypeId: value.eventTypeId,
    ...(value.payload === undefined ? {} : { payload: value.payload }) };
}

function matches(event: StoredEvent, input: RunEventsInput) {
  return (!input.eventType || input.eventType === event.eventTypeId)
    && (!input.since || Date.parse(event.timestamp) >= Date.parse(input.since))
    && (!input.until || Date.parse(event.timestamp) <= Date.parse(input.until));
}

/** 路由标识单独投影；不从截断 JSON 推测，也不截短 ID 后冒充另一个节点。 */
function routeSummary(payload: unknown): { source?: string; target?: string } {
  if (!record(payload)) return {};
  const valid = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160;
  return { ...(valid(payload.source) ? { source: payload.source } : {}),
    ...(valid(payload.target) ? { target: payload.target } : {}) };
}

function filterScope(input: RunEventsInput) {
  return createHash('sha256').update(JSON.stringify([input.workflowId, input.executionId,
    input.eventType, input.since, input.until])).digest('hex');
}

function decodeCursor(raw: string, size: number, scope: string): Cursor {
  try {
    const item: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!record(item) || !Number.isSafeInteger(item.position) || !Number.isSafeInteger(item.end)
      || Number(item.position) < 0 || Number(item.position) > Number(item.end)
      || Number(item.end) > size || item.scope !== scope) throw new Error('cursor');
    return { position: Number(item.position), end: Number(item.end), scope };
  } catch (error) { throw historyError('TRADEWIND_HISTORY_INVALID_CURSOR', '运行事件分页游标无效', error); }
}

function oversized() { return historyError('TRADEWIND_HISTORY_TOO_LARGE', '单条运行事件超过读取上限'); }
