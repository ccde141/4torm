import { probeDefinitions } from './catalog.js';
import { ProbeContractError, type ProbeItem, type ProbeSelection,
  type ProbeProjection, type ProbeProjectionOptions } from './contracts.js';
import { normalizeProbeFields, validateKnownProbe, validateProbe } from './validation.js';

const definitions = probeDefinitions();

/** Tolerant consumer: optional future fields are ignored, invalid known fields are errors. */
export function consumeProbe(value: unknown, fields: readonly string[]): ProbeItem {
  validateKnownProbe(value);
  return select(value, { fields, audience: 'human' });
}

export function selectProbe(value: unknown, selection: ProbeSelection): ProbeItem {
  validateProbe(value);
  normalizeProbeFields(selection.fields);
  return select(value, selection);
}

function select(value: ProbeItem, selection: ProbeSelection): ProbeItem {
  const result: Record<string, unknown> = {};
  // Audience filtering is a disclosure boundary, including for future optional fields.
  for (const field of definitions) {
    if (!field.audiences.includes(selection.audience)) continue;
    if (!field.required && selection.fields && !selection.fields.includes(field.key)) continue;
    if (value[field.key] !== undefined) result[field.key] = value[field.key];
  }
  validateProbe(result);
  return result;
}

export function projectProbes(source: readonly ProbeItem[], options: ProbeProjectionOptions): ProbeProjection {
  for (const value of [options.limit, options.maxTextChars, options.maxTextLines]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ProbeContractError('PROBE_BUDGET_INVALID', '探针预算必须是正整数');
    }
  }
  const result: ProbeProjection = { items: [], consumed: 0, contentTruncated: false };
  const budget = { chars: options.maxTextChars, lines: options.maxTextLines, used: false };
  for (const item of source.slice(0, options.limit)) {
    const selected = selectProbe(item, options);
    if (budget.chars <= (budget.used ? 1 : 0) || budget.lines <= 0) break;
    const projected = boundItem(selected, budget);
    result.items.push(projected.item);
    result.contentTruncated ||= projected.truncated;
    result.consumed++;
  }
  return result;
}

interface TextBudget { chars: number; lines: number; used: boolean }

function boundItem(source: ProbeItem, budget: TextBudget): { item: ProbeItem; truncated: boolean } {
  const item: ProbeItem = { operationId: source.operationId, status: source.status, title: source.title };
  let truncated = false;
  for (const field of definitions) {
    if (field.key === 'operationId' || field.key === 'status' || source[field.key] === undefined) continue;
    const value = source[field.key];
    if (typeof value !== 'string') { Object.assign(item, { [field.key]: value }); continue; }
    const separator = budget.used ? 1 : 0;
    const available = Math.max(0, budget.chars - separator);
    const normalized = field.key === 'title' ? value.replace(/[\r\n]/g, ' ') : value;
    const text = normalized.split('\n').slice(0, budget.lines).join('\n').slice(0, available);
    // Identifiers/timestamps/codes must be whole; only display text can be shortened.
    const canShorten = ['title', 'waitingReason', 'errorMessage', 'resultSummary'].includes(field.key);
    const output = text.length === value.length || canShorten ? text : '';
    truncated ||= output !== value;
    if (!output) continue;
    Object.assign(item, { [field.key]: output });
    budget.chars -= separator + output.length;
    budget.lines -= output.split('\n').length;
    budget.used = true;
  }
  return { item, truncated };
}

export function probeText(items: readonly ProbeItem[]): string {
  return items.flatMap(item => definitions.filter(field => field.key !== 'operationId'
    && field.key !== 'status' && typeof item[field.key] === 'string')
    .map(field => item[field.key] as string)).join('\n');
}
