import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { frameworkError } from '../shared/framework-error.js';
import { readJsonSafe, seatFile, seatsDir, workshopMetaFile } from './paths.js';
import type { SeatData } from './types.js';

export type SeatHistorySource = 'human' | 'seat-agent' | 'supervisor' | 'unknown';
export interface SeatHistoryRecord {
  id: string;
  workshopId: string;
  seatId: string;
  kind: 'configuration' | 'binding' | 'memory';
  timestamp: string;
  source: SeatHistorySource;
  changedFields?: string[];
  previousAgentId?: string;
  agentId?: string;
  memoryId?: string;
  memoryTitle?: string;
  memoryRevision?: number;
}

const CONFIGURATION_FIELDS = ['title', 'rolePrompt', 'duty', 'overrideAgentRole',
  'agentId', 'collaboration'] as const;
const RECORD_KEYS = ['id', 'workshopId', 'seatId', 'kind', 'timestamp', 'source',
  'changedFields', 'previousAgentId', 'agentId', 'memoryId', 'memoryTitle', 'memoryRevision'];

/** The owning primary file commits its metadata and change record together. */
export function appendSeatConfigurationHistory(
  workshopId: string, previous: SeatData, next: SeatData,
  source: SeatHistorySource = 'unknown',
): void {
  const history = parseSeatHistory(previous.history, workshopId, previous.id, 'configuration');
  const changedFields = CONFIGURATION_FIELDS.filter(field => (
    JSON.stringify(configurationValue(previous, field)) !== JSON.stringify(configurationValue(next, field))
  ));
  if (!changedFields.length) return;
  const binding = changedFields.includes('agentId');
  next.history = [...history, {
    id: `seat-change-${randomUUID()}`, workshopId, seatId: next.id,
    kind: binding ? 'binding' : 'configuration', timestamp: new Date().toISOString(), source,
    changedFields,
    ...(binding ? { previousAgentId: previous.agentId, agentId: next.agentId } : {}),
  }];
}

export function seatMemoryHistoryRecord(
  workshopId: string, seatId: string,
  entry: { id: string; title: string; updatedAt: string }, revision: number,
  source: SeatHistorySource,
): SeatHistoryRecord {
  return { id: `seat-memory-${randomUUID()}`, workshopId, seatId, kind: 'memory',
    timestamp: entry.updatedAt, source, memoryId: entry.id, memoryTitle: entry.title,
    memoryRevision: revision };
}

/** Legacy files have no recorded changes; never derive events from their current values. */
export async function readSeatHistory(
  dataDir: string, workshopId: string, seatId: string,
): Promise<SeatHistoryRecord[]> {
  identifier(workshopId); identifier(seatId);
  const workshop = await readJsonSafe<{ seatIds?: unknown }>(workshopMetaFile(dataDir, workshopId));
  const seatIds = workshop?.seatIds;
  if (workshop && !Array.isArray(seatIds)) throw corrupt();
  if (!Array.isArray(seatIds) || !seatIds.includes(seatId)) throw notFound();
  const seat = await readJsonSafe<SeatData>(seatFile(dataDir, workshopId, seatId));
  if (!seat) throw notFound();
  if (seat.id !== seatId) throw corrupt();
  const file = path.join(seatsDir(dataDir, workshopId), `${seatId}.memory.json`);
  const memory = await readJsonSafe<unknown>(file);
  const memoryHistory = memory === null ? [] : memoryRecords(memory, workshopId, seatId);
  return [...parseSeatHistory(seat.history, workshopId, seatId, 'configuration'), ...memoryHistory]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id));
}

export function parseSeatHistory(
  value: unknown, workshopId: string, seatId: string, owner: 'configuration' | 'memory',
): SeatHistoryRecord[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw corrupt();
  const ids = new Set<string>();
  for (const item of value) {
    if (!record(item) || Object.keys(item).some(key => !RECORD_KEYS.includes(key))
      || !validRecord(item, workshopId, seatId, owner) || ids.has(item.id)) throw corrupt();
    ids.add(item.id);
  }
  return structuredClone(value) as SeatHistoryRecord[];
}

function configurationValue(seat: SeatData, field: typeof CONFIGURATION_FIELDS[number]): unknown {
  if (field === 'overrideAgentRole') return seat.overrideAgentRole === true;
  if (field === 'collaboration') return { contact: seat.collaboration?.contact !== false,
    dispatch: seat.collaboration?.dispatch !== false, bulletin: seat.collaboration?.bulletin !== false };
  return seat[field];
}

function memoryRecords(value: unknown, workshopId: string, seatId: string): SeatHistoryRecord[] {
  if (!record(value) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0
    || !Array.isArray(value.entries) || value.entries.length > 200
    || value.entries.some(entry => !record(entry) || typeof entry.id !== 'string' || !entry.id
      || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.content !== 'string'
      || !validTime(entry.updatedAt))
    || new Set(value.entries.map(entry => entry.id)).size !== value.entries.length) throw corrupt();
  return parseSeatHistory(value.history, workshopId, seatId, 'memory');
}

function validRecord(value: Record<string, unknown>, workshopId: string, seatId: string,
  owner: 'configuration' | 'memory'): value is SeatHistoryRecord & Record<string, unknown> {
  if (!isIdentifier(value.id) || value.workshopId !== workshopId || value.seatId !== seatId
    || !validTime(value.timestamp) || !['human', 'seat-agent', 'supervisor', 'unknown'].includes(String(value.source))) return false;
  if (owner === 'memory') {
    return value.kind === 'memory' && typeof value.memoryId === 'string' && Boolean(value.memoryId)
      && value.memoryId.length <= 160 && typeof value.memoryTitle === 'string'
      && Boolean(value.memoryTitle.trim()) && value.memoryTitle.length <= 200
      && Number.isSafeInteger(value.memoryRevision) && (value.memoryRevision as number) > 0
      && value.changedFields === undefined && value.previousAgentId === undefined && value.agentId === undefined;
  }
  if (value.kind !== 'configuration' && value.kind !== 'binding') return false;
  const fields = value.changedFields;
  if (!Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length
    || fields.some(field => !CONFIGURATION_FIELDS.includes(field))
    || value.memoryId !== undefined || value.memoryTitle !== undefined || value.memoryRevision !== undefined) return false;
  return value.kind === 'binding'
    ? fields.includes('agentId') && isIdentifier(value.previousAgentId) && isIdentifier(value.agentId)
      && value.previousAgentId !== value.agentId
    : !fields.includes('agentId') && value.previousAgentId === undefined && value.agentId === undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
}

function identifier(value: unknown): void { if (!isIdentifier(value)) throw corrupt(); }

function corrupt() {
  return frameworkError({ code: 'CYCLONE_SEAT_HISTORY_CORRUPT', kind: 'io',
    message: '工位变更履历已损坏，原文件已保留', source: 'cyclone.seat-history', retryable: false });
}

function notFound() {
  return frameworkError({ code: 'CYCLONE_SEAT_NOT_FOUND', kind: 'not_found',
    message: '工位不存在或不属于当前工作室', source: 'cyclone.seat-history', retryable: false });
}
