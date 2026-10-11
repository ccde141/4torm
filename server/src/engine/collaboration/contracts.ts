import { PROBE_STATUSES } from '../../shared/probes/public.js';
import type { ProbeItem } from '../../shared/probes/public.js';
import type { FrameworkCapabilityDescriptor } from '../../shared/framework-capability.js';

export const COLLABORATION_FEATURES = [
  'monsoon',
  'convection',
  'cyclone',
  'tradewind',
  'tide',
] as const;

export const COLLABORATION_PERMISSIONS = [
  'observe',
  'design',
  'execute',
  'intervene',
  'administer',
] as const;

export const COLLABORATION_STATUSES = PROBE_STATUSES;

export type CollaborationFeature = typeof COLLABORATION_FEATURES[number];
export type CollaborationPermission = typeof COLLABORATION_PERMISSIONS[number];
export type CollaborationStatus = typeof COLLABORATION_STATUSES[number];
export type ObservationView = 'summary' | 'detail' | 'events';
export type ModuleAudience = 'human' | 'agent' | 'internal';
export type ModuleMethodKind = 'query' | 'command';
export type ModuleOutputMode = 'inline' | 'operation' | 'artifact';
export type OutputBudgetKey = 'items' | 'events' | 'textChars' | 'textLines';

export type CollaborationActor =
  | { type: 'human' | 'agent'; id: string; actingAs: 'human' }
  | { type: 'system'; id: string; actingAs: 'system' };

export interface CollaborationContext {
  actor: CollaborationActor;
  audience: ModuleAudience;
  enabledFeatures: ReadonlySet<CollaborationFeature>;
  permissions: ReadonlySet<CollaborationPermission>;
  requestId: string;
  signal?: AbortSignal;
}

export interface ObservationQueryInput {
  fields?: string[];
  view?: ObservationView;
  limit?: number;
  eventLimit?: number;
  maxTextChars?: number;
  maxTextLines?: number;
  cursor?: string;
}

export interface ObservationQuery {
  fields?: string[];
  view: ObservationView;
  limit: number;
  eventLimit: number;
  maxTextChars: number;
  maxTextLines: number;
  cursor?: string;
}

export type ObservationItem = ProbeItem;

export interface ObservationPage {
  feature: CollaborationFeature;
  revision: string;
  items: ObservationItem[];
  truncated: boolean;
  contentTruncated?: boolean;
  nextCursor?: string;
}

export interface ObservationEnvelope extends ObservationPage {
  schemaVersion: 1;
  view: ObservationView;
  observedAt: string;
  completeness: 'complete' | 'partial';
}

export interface CollaborationMethodSummary {
  id: string;
  kind: ModuleMethodKind;
  permission: CollaborationPermission;
  outputMode: ModuleOutputMode;
}

export interface CollaborationFeatureSnapshot {
  id: CollaborationFeature;
  version: number;
  title: string;
  methods: CollaborationMethodSummary[];
  observation?: ObservationEnvelope;
  observationFailure?: { code: string; kind: string; message: string };
}

export interface CollaborationSnapshot {
  schemaVersion: 1;
  revision: string;
  observedAt: string;
  completeness: 'complete' | 'partial';
  features: CollaborationFeatureSnapshot[];
}

export interface OutputBudgetRule {
  default: number;
  max: number;
}

export type OutputBudgetPolicy = Partial<Record<OutputBudgetKey, OutputBudgetRule>>;
export type OutputBudgetRequest = Partial<Record<OutputBudgetKey, number>>;
export type ResolvedOutputBudget = Readonly<Partial<Record<OutputBudgetKey, number>>>;

export interface ModuleMethodManifest {
  id: string;
  kind: ModuleMethodKind;
  permission: CollaborationPermission;
  audiences: ModuleAudience[];
  agentTool?: AgentToolManifest;
  inputSchema: Record<string, unknown>;
  output: {
    mode: ModuleOutputMode;
    budget?: OutputBudgetPolicy;
  };
}

export interface AgentToolManifest {
  name: string;
  description: string;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  frameworkCapability?: FrameworkCapabilityDescriptor;
}

export interface AgentToolBinding {
  feature: CollaborationFeature;
  method: string;
  definition: AgentToolDefinition;
}

export class AgentToolOutput {
  constructor(
    readonly value: unknown,
    readonly meta?: Record<string, unknown>,
  ) {}
}

export function agentToolOutput(
  value: unknown,
  meta?: Record<string, unknown>,
): AgentToolOutput {
  return new AgentToolOutput(value, meta);
}

export interface FeatureManifest {
  id: CollaborationFeature;
  version: number;
  title: string;
  agentCapability?: FrameworkCapabilityDescriptor;
  observation?: ObservationPortManifest;
  operation?: { inspect: true; wait: boolean; records?: true };
  methods: ModuleMethodManifest[];
  transports?: ModuleTransportManifest[];
}

export interface ModuleTransportManifest {
  id: string;
  permission: CollaborationPermission;
  audiences: ModuleAudience[];
  inputSchema: Record<string, unknown>;
}

export interface ModuleTransportHandler {
  parse(input: unknown): unknown;
  prepare(context: CollaborationContext, input: unknown): Promise<unknown>;
}

export interface ObservationPortManifest {
  permission: CollaborationPermission;
  audiences: ModuleAudience[];
  views: ObservationView[];
  budget: OutputBudgetPolicy;
}

export interface ModuleCall {
  feature: CollaborationFeature;
  method: string;
  input: unknown;
  budget?: OutputBudgetRequest;
}

export interface ModuleInvocationContext extends CollaborationContext {
  budget: ResolvedOutputBudget;
}

export interface ModuleMethodHandler {
  parse(input: unknown): unknown;
  invoke(context: ModuleInvocationContext, input: unknown): Promise<unknown>;
}

export interface FeatureModule {
  manifest: FeatureManifest;
  handlers: Record<string, ModuleMethodHandler>;
  transports?: Record<string, ModuleTransportHandler>;
  observation?: FeatureObservationHandler;
  operations?: FeatureOperationHandler;
  records?: FeatureRecordHandler;
}

export interface FeatureObservationHandler {
  query(context: CollaborationContext, query: ObservationQuery): Promise<ObservationPage>;
}

export interface OperationIdentity {
  operationId: string;
  runId: string;
}

export interface FeatureOperationHandler {
  inspect(identity: OperationIdentity): Promise<ProbeItem | null>;
  subscribe?(identity: OperationIdentity, listener: () => void): () => void;
}

export interface OperationRecordSummary extends OperationIdentity {
  title: string;
  status: CollaborationStatus;
  timestamp: string;
  /** Agent that actually ran this operation, when the island can prove it. */
  agentId?: string;
  /** Agents observed starting this run; a group run can contain more than one. */
  agentIds?: string[];
  /** Source session, if this record belongs to a conversation. */
  sessionId?: string;
  /** A confirmed append destination; absent until the write succeeds. */
  linkedSessionId?: string;
}

export interface FeatureRecordHandler {
  list(context: CollaborationContext): Promise<OperationRecordSummary[]>;
  read(context: CollaborationContext, identity: OperationIdentity): Promise<unknown | null>;
}
