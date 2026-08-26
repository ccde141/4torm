import type { ModelInputModality } from './provider-config.js';

export interface ModelCapabilities {
  contextWindowTokens?: number;
  contextTokenLimit?: number;
  maxOutputTokens?: number;
  parallelSlots?: number;
  input?: ModelInputModality[];
  reasoning?: boolean;
  tools?: boolean;
}

export type CapabilityEvidenceSource =
  | 'configured'
  | 'metadata'
  | 'probe'
  | 'adapter-default';

export interface CapabilityEvidence {
  source: CapabilityEvidenceSource;
  observedAt?: string;
  expiresAt?: string;
  probeVersion?: number;
  endpointFingerprint?: string;
  modelFingerprint?: string;
}

export interface CapabilityCorrection {
  field: keyof ModelCapabilities;
  declared: unknown;
  observed: unknown;
  effective: unknown;
  reason: string;
}

export interface EffectiveModelCapabilities {
  declared?: ModelCapabilities;
  observed?: ModelCapabilities;
  effective: ModelCapabilities;
  evidence: CapabilityEvidence[];
  corrections: CapabilityCorrection[];
}
