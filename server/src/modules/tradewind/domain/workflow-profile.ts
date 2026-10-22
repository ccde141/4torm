import type { AutoProfile } from '../../../engine/tradewind/foundation/types/auto-profile.js';

/** A profile has the same contract whether it comes from a UI, an Agent or persisted data. */
export function parseWorkflowProfile(value: unknown): AutoProfile {
  const item = exact(value, ['id', 'name', 'cadence', 'overlap', 'lapBound', 'carryOver', 'loopNote', 'summaryPrompt']);
  const cadence = exact(item.cadence, ['kind', 'gapSec', 'by']);
  if (item.overlap !== 'skip' && item.overlap !== 'queue') throw invalid();
  if (!['accumulate', 'reset', 'summary'].includes(String(item.carryOver))) throw invalid();
  if (item.lapBound !== null && (!Number.isSafeInteger(item.lapBound) || Number(item.lapBound) < 1)) throw invalid();
  let parsedCadence: AutoProfile['cadence'];
  if (cadence.kind === 'relative' && cadence.by === undefined
    && typeof cadence.gapSec === 'number' && Number.isFinite(cadence.gapSec) && cadence.gapSec >= 0) {
    parsedCadence = { kind: 'relative', gapSec: cadence.gapSec };
  } else if (cadence.kind === 'absolute' && cadence.by === 'tide' && cadence.gapSec === undefined) {
    parsedCadence = { kind: 'absolute', by: 'tide' };
  } else throw invalid();
  return { id: identifier(item.id), name: text(item.name, 200), cadence: parsedCadence,
    overlap: item.overlap, lapBound: item.lapBound as number | null,
    carryOver: item.carryOver as AutoProfile['carryOver'],
    ...(item.loopNote === undefined ? {} : { loopNote: text(item.loopNote, 4_000) }),
    ...(item.summaryPrompt === undefined ? {} : { summaryPrompt: text(item.summaryPrompt, 4_000) }) };
}

function exact(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(value)) throw invalid();
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid();
  return value.trim();
}
function invalid(): Error { return new Error('信风循环档案格式无效'); }
