import { frameworkError } from '../shared/framework-error.js';
import { normalizeProbeFields, ProbeContractError } from '../../shared/probes/public.js';
import type {
  ObservationQuery,
  ObservationQueryInput,
  ObservationView,
  OutputBudgetKey,
  OutputBudgetPolicy,
  OutputBudgetRequest,
  ResolvedOutputBudget,
} from './contracts.js';

export const OBSERVATION_LIMITS = Object.freeze({
  defaultItems: 20,
  maxItems: 100,
  defaultEvents: 12,
  maxEvents: 50,
  defaultTextChars: 4_000,
  maxTextChars: 12_000,
  defaultTextLines: 80,
  maxTextLines: 200,
  maxCursorChars: 512,
});

export interface BoundedText {
  text: string;
  truncated: boolean;
  originalChars: number;
  originalLines: number;
}

export function normalizeObservationQuery(input: ObservationQueryInput): ObservationQuery {
  const query: ObservationQuery = {
    view: normalizeView(input.view),
    limit: normalizeBudget(input.limit, OBSERVATION_LIMITS.defaultItems, OBSERVATION_LIMITS.maxItems),
    eventLimit: normalizeBudget(
      input.eventLimit,
      OBSERVATION_LIMITS.defaultEvents,
      OBSERVATION_LIMITS.maxEvents,
    ),
    maxTextChars: normalizeBudget(
      input.maxTextChars,
      OBSERVATION_LIMITS.defaultTextChars,
      OBSERVATION_LIMITS.maxTextChars,
    ),
    maxTextLines: normalizeBudget(
      input.maxTextLines,
      OBSERVATION_LIMITS.defaultTextLines,
      OBSERVATION_LIMITS.maxTextLines,
    ),
  };
  if (input.cursor !== undefined) query.cursor = normalizeCursor(input.cursor);
  if (input.fields !== undefined) query.fields = parseProbeFields(input.fields);
  return query;
}

function parseProbeFields(value: unknown): string[] | undefined {
  try { return normalizeProbeFields(value); }
  catch (error) {
    if (!(error instanceof ProbeContractError)) throw error;
    throw frameworkError({ code: error.code, kind: 'validation', message: error.message,
      source: 'collaboration.budget', retryable: false }, { cause: error });
  }
}

export function resolveObservationQuery(
  input: ObservationQueryInput,
  policy: OutputBudgetPolicy,
): ObservationQuery {
  validateObservationBudgetPolicy(policy);
  const base = normalizeObservationQuery(input);
  const requested: OutputBudgetRequest = {};
  if (input.limit !== undefined) requested.items = input.limit;
  if (input.eventLimit !== undefined) requested.events = input.eventLimit;
  if (input.maxTextChars !== undefined) requested.textChars = input.maxTextChars;
  if (input.maxTextLines !== undefined) requested.textLines = input.maxTextLines;
  const budget = resolveOutputBudget(policy, requested);
  return {
    ...base,
    limit: budget.items!, eventLimit: budget.events!,
    maxTextChars: budget.textChars!, maxTextLines: budget.textLines!,
  };
}

export function validateObservationBudgetPolicy(policy: OutputBudgetPolicy): void {
  validateBudgetPolicy(policy);
  const limits: Record<OutputBudgetKey, number> = {
    items: OBSERVATION_LIMITS.maxItems,
    events: OBSERVATION_LIMITS.maxEvents,
    textChars: OBSERVATION_LIMITS.maxTextChars,
    textLines: OBSERVATION_LIMITS.maxTextLines,
  };
  for (const [key, maximum] of Object.entries(limits) as Array<[OutputBudgetKey, number]>) {
    const rule = policy[key];
    if (!rule || rule.max > maximum) throw invalidObservationPolicy(key);
  }
}

export function boundObservationText(
  text: string,
  budget: { maxChars: number; maxLines: number },
): BoundedText {
  assertPositiveInteger(budget.maxChars);
  assertPositiveInteger(budget.maxLines);
  const lines = text.split('\n');
  const lineBounded = lines.slice(0, budget.maxLines).join('\n');
  const bounded = lineBounded.slice(0, budget.maxChars);
  return {
    text: bounded,
    truncated: bounded.length < text.length,
    originalChars: text.length,
    originalLines: lines.length,
  };
}

export function resolveOutputBudget(
  policy: OutputBudgetPolicy | undefined,
  requested: OutputBudgetRequest | undefined,
): ResolvedOutputBudget {
  if (!policy) {
    if (requested && Object.keys(requested).length > 0) throw unsupportedBudget();
    return Object.freeze({});
  }
  validateBudgetPolicy(policy);
  const resolved: Record<string, number> = {};
  for (const [key, rule] of Object.entries(policy)) {
    const request = requested?.[key as keyof OutputBudgetRequest];
    resolved[key] = normalizeBudget(request, rule.default, rule.max);
  }
  const unsupported = Object.keys(requested ?? {}).find(key => !(key in policy));
  if (unsupported) throw unsupportedBudget();
  return Object.freeze(resolved);
}

export function validateBudgetPolicy(policy: OutputBudgetPolicy): void {
  for (const rule of Object.values(policy)) {
    assertPositiveInteger(rule.default);
    assertPositiveInteger(rule.max);
    if (rule.default > rule.max) {
      throw frameworkError({
        code: 'OUTPUT_BUDGET_POLICY_INVALID', kind: 'validation',
        message: '输出预算默认值不能超过最大值',
        source: 'collaboration.budget', retryable: false,
      });
    }
  }
}

function normalizeBudget(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  assertPositiveInteger(value);
  return Math.min(value, maximum);
}

function assertPositiveInteger(value: number): void {
  if (Number.isInteger(value) && value > 0) return;
  throw frameworkError({
    code: 'OBSERVATION_BUDGET_INVALID',
    kind: 'validation',
    message: '观察输出预算必须是正整数',
    source: 'collaboration.budget',
    retryable: false,
  });
}

function normalizeView(view: ObservationView | undefined): ObservationView {
  if (view === undefined || view === 'summary' || view === 'detail' || view === 'events') {
    return view ?? 'summary';
  }
  throw frameworkError({
    code: 'OBSERVATION_VIEW_INVALID',
    kind: 'validation',
    message: '未知的观察视图',
    source: 'collaboration.budget',
    retryable: false,
  });
}

function normalizeCursor(cursor: string): string {
  if (cursor.length > 0 && cursor.length <= OBSERVATION_LIMITS.maxCursorChars) return cursor;
  throw frameworkError({
    code: 'OBSERVATION_CURSOR_INVALID',
    kind: 'validation',
    message: '观察游标无效',
    source: 'collaboration.budget',
    retryable: false,
  });
}

function unsupportedBudget() {
  return frameworkError({
    code: 'OUTPUT_BUDGET_UNSUPPORTED', kind: 'validation',
    message: '此调用口不支持请求的输出预算',
    source: 'collaboration.budget', retryable: false,
  });
}

function invalidObservationPolicy(key: OutputBudgetKey) {
  return frameworkError({
    code: 'OBSERVATION_BUDGET_POLICY_INVALID', kind: 'validation',
    message: '观察端口预算缺失或超过框架上限',
    source: 'collaboration.budget', retryable: false, details: { key },
  });
}
