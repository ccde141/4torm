/** Add optional terms without changing v1 identity or lifecycle semantics. */
export const PROBE_STATUSES = [
  'idle', 'queued', 'running', 'waiting', 'completed', 'aborted', 'failed', 'crashed',
] as const;
export type ProbeStatus = typeof PROBE_STATUSES[number];
export type ProbeAudience = 'human' | 'agent' | 'internal';

export interface ProbeItem {
  operationId: string;
  status: ProbeStatus;
  title: string;
  phase?: string;
  updatedAt?: string;
  agentId?: string;
  runId?: string;
  parentOperationId?: string;
  completedUnits?: number;
  totalUnits?: number;
  unit?: string;
  waitingReason?: string;
  errorCode?: string;
  errorMessage?: string;
  resultSummary?: string;
  artifactId?: string;
  schedule?: string;
  enabled?: boolean;
  diagnosticCode?: string;
}

export type ProbeField = keyof ProbeItem;
export interface ProbeFieldDefinition {
  key: ProbeField;
  description: string;
  type: 'string' | 'number' | 'boolean';
  format?: 'identifier' | 'timestamp' | 'status';
  required: boolean;
  since: 1;
  audiences: ProbeAudience[];
  maxLength?: number;
  minimum?: number;
  values?: readonly string[];
}

export interface ProbeSelection {
  fields?: readonly string[];
  audience: ProbeAudience;
}

export interface ProbeProjectionOptions extends ProbeSelection {
  limit: number;
  maxTextChars: number;
  maxTextLines: number;
}

export interface ProbeProjection {
  items: ProbeItem[];
  consumed: number;
  contentTruncated: boolean;
}

export class ProbeContractError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
