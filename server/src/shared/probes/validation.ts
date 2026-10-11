import { probeDefinitions } from './catalog.js';
import { ProbeContractError, type ProbeFieldDefinition, type ProbeItem } from './contracts.js';

const fields = probeDefinitions();
const known = new Set(fields.map(field => field.key as string));

export function validateProbe(value: unknown): asserts value is ProbeItem {
  validate(value, true);
}

export function validateKnownProbe(value: unknown): asserts value is ProbeItem {
  validate(value, false);
}

function validate(value: unknown, strict: boolean): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const record = value as Record<string, unknown>;
  if (strict && Object.keys(record).some(key => !known.has(key))) throw invalid();
  for (const field of fields) {
    const entry = Object.hasOwn(record, field.key) ? record[field.key] : undefined;
    if (entry === undefined && !field.required) continue;
    if (!validValue(field, entry)) throw invalid();
  }
  const { completedUnits, totalUnits } = record;
  if (typeof completedUnits === 'number' && typeof totalUnits === 'number'
    && completedUnits > totalUnits) throw invalid();
}

function validValue(field: ProbeFieldDefinition, value: unknown): boolean {
  if (typeof value !== field.type) return false;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= (field.minimum ?? 0);
  if (typeof value !== 'string') return true;
  if (!value.length || value.length > field.maxLength!) return false;
  if (field.values && !field.values.includes(value)) return false;
  if (field.format === 'identifier') return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
  if (field.format === 'timestamp') {
    return validTimestamp(value);
  }
  return true;
}

function validTimestamp(value: string): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  if (!iso.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const date = value.slice(0, 10);
  const midnight = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(midnight.getTime()) && midnight.toISOString().slice(0, 10) === date;
}

export function normalizeProbeFields(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > fields.length
    || value.some(key => typeof key !== 'string' || !known.has(key))) {
    throw new ProbeContractError('PROBE_FIELDS_INVALID', '探针字段选择无效');
  }
  return [...new Set(value as string[])];
}

function invalid(): ProbeContractError {
  return new ProbeContractError('PROBE_OUTPUT_INVALID', '探针包含未登记字段或无效值');
}
