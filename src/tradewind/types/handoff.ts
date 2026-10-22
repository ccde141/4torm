/** Runtime projection only; persisted envelope/activation facts remain owned by the engine. */
export interface HandoffState {
  totalRoots: number;
  completedRoots: number;
  envelopes: Array<{ envelopeId: string; entryNodeId: string; completed: boolean }>;
  nodes: Array<{ nodeId: string; queuedEnvelopeIds: string[]; envelopeId?: string; activationId?: string; startedAt?: string }>;
  lastHandoffs: Array<{ envelopeId: string; activationId: string; sourceActivationId: string;
    handoffId: string; source: string; target: string; edgeId: string; sentAt: string; receivedAt: string }>;
}
