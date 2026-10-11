import { selectProbe, probeText, validateProbe, ProbeContractError } from '../../shared/probes/public.js';
import { frameworkError } from '../shared/framework-error.js';
import type { CollaborationFeature, ModuleAudience, ObservationPage, ObservationQuery } from './contracts.js';

/** Validate producers before projecting, so field selection cannot conceal broken contracts. */
export function observationOutput(
  value: unknown, feature: CollaborationFeature, query: ObservationQuery, audience: ModuleAudience,
): ObservationPage {
  try {
    assertPage(value, feature, query.limit);
    const items = value.items.map(item => selectProbe(item, { audience, fields: query.fields }));
    const text = probeText(items);
    if (text.length > query.maxTextChars || (text ? text.split('\n').length : 0) > query.maxTextLines) {
      throw new Error('Probe output exceeds budget');
    }
    return { feature, revision: value.revision, items, truncated: value.truncated,
      ...(value.nextCursor === undefined ? {} : { nextCursor: value.nextCursor }),
      ...(value.contentTruncated === undefined ? {} : { contentTruncated: value.contentTruncated }) };
  } catch (error) {
    throw invalidOutput(feature, error);
  }
}

export function observationSourceError(error: unknown, feature: CollaborationFeature): never {
  if (error instanceof ProbeContractError) throw invalidOutput(feature, error);
  throw error;
}

function invalidOutput(feature: CollaborationFeature, cause: unknown) {
  return frameworkError({ code: 'OBSERVATION_OUTPUT_INVALID', kind: 'internal',
    message: '功能模组返回了无效状态数据', source: 'collaboration.router', retryable: false,
    details: { feature } }, { cause });
}

function assertPage(value: unknown, feature: CollaborationFeature, limit: number): asserts value is ObservationPage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid page');
  const page = value as Record<string, unknown>;
  const keys = ['feature', 'revision', 'items', 'truncated', 'contentTruncated', 'nextCursor'];
  if (Object.keys(page).some(key => !keys.includes(key)) || page.feature !== feature
    || typeof page.revision !== 'string' || !page.revision.length || page.revision.length > 512
    || !Array.isArray(page.items) || page.items.length > limit || typeof page.truncated !== 'boolean'
    || (page.contentTruncated !== undefined && typeof page.contentTruncated !== 'boolean')) {
    throw new Error('Invalid page');
  }
  const ids = new Set<string>();
  for (const item of page.items) {
    validateProbe(item);
    if (ids.has(item.operationId)) throw new Error('Duplicate identity');
    ids.add(item.operationId);
  }
  if (page.truncated ? !page.items.length || typeof page.nextCursor !== 'string'
    || !page.nextCursor.length || page.nextCursor.length > 512 : page.nextCursor !== undefined) {
    throw new Error('Invalid pagination');
  }
}
