export const PROVIDER_VERIFICATION_STATES = [
  'unverified',
  'configured',
  'reachable',
  'transport-ready',
  'context-ready',
  'tools-ready',
  'concurrency-ready',
  'framework-ready',
  'degraded',
  'stale',
] as const;

export type ProviderVerificationState = typeof PROVIDER_VERIFICATION_STATES[number];

export type ProbeOutcome = 'supported' | 'unsupported' | 'failed';

export interface ProviderVerification {
  state: ProviderVerificationState;
  checkedAt?: string;
  adapterVersion?: number;
  endpointFingerprint?: string;
  details?: Record<string, ProbeOutcome>;
}
