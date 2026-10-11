import { createHash } from 'node:crypto';
import { frameworkErrorFromUnknown } from '../shared/framework-error.js';
import { observationOutput, observationSourceError } from './observation-output.js';
import { inspectOperationFact, verifiedOperationOutput } from './operation-output.js';
import { AgentToolOutput } from './contracts.js';
import {
  resolveObservationQuery,
  resolveOutputBudget,
} from './budget.js';
import type {
  AgentToolBinding, CollaborationContext,
  CollaborationSnapshot, CollaborationFeatureSnapshot,
  CollaborationFeature,
  CollaborationPermission,
  FeatureManifest,
  FeatureModule,
  ModuleCall,
  ObservationEnvelope,
  ObservationQueryInput,
  OperationIdentity,
} from './contracts.js';
import { selectProbe, type ProbeItem } from '../../shared/probes/public.js';
import { waitForOperation, type OperationWaitResult } from './operation-wait.js';
import { prepareFeatureTransport } from './router-transport.js';
import { latestAgentRecords } from './latest-agent-records.js';
import { readAgentPresence, type AgentPresencePort } from './presence.js';
import { invokeGlobalSettings, type GlobalSettingsPort, type GlobalSettingsMethod } from './global-settings-port.js';
import {
  listOperationRecords, readOperationRecord,
  type RecordListInput, type RecordReadInput,
} from './record-router.js';
import {
  assertCallable,
  assertEnabled,
  assertObservationCallable,
  assertPermission,
  parseInput,
  routerError,
  validateModule,
  visibleManifest,
} from './router-guards.js';

export class CollaborationRouter {
  private readonly modules = new Map<CollaborationFeature, FeatureModule>();

  constructor(modules: FeatureModule[] = [], private readonly presencePort?: AgentPresencePort,
    private readonly settingsPort?: GlobalSettingsPort) {
    for (const featureModule of modules) this.register(featureModule);
  }

  globalSettings(method: GlobalSettingsMethod, input: unknown, context: CollaborationContext): Promise<unknown> {
    return invokeGlobalSettings(this.settingsPort, method, input, context);
  }

  agentPresence(context: CollaborationContext) {
    return readAgentPresence(this.presencePort, context);
  }

  register(featureModule: FeatureModule): void {
    const feature = featureModule.manifest.id;
    if (this.modules.has(feature)) {
      throw routerError('FEATURE_MODULE_DUPLICATE', 'conflict', '功能模组重复注册', feature);
    }
    validateModule(featureModule);
    this.assertUniqueAgentTools(featureModule);
    this.modules.set(feature, featureModule);
  }

  prepareTransport(
    feature: CollaborationFeature, portId: string, input: unknown,
    context: CollaborationContext,
  ): Promise<unknown> {
    return prepareFeatureTransport(this.modules, feature, portId, input, context);
  }

  listAgentTools(): AgentToolBinding[] {
    return [...this.modules.values()].flatMap(featureModule =>
      featureModule.manifest.methods.flatMap(method => method.agentTool ? [{
        feature: featureModule.manifest.id,
        method: method.id,
        definition: {
          name: method.agentTool.name,
          description: method.agentTool.description,
          parameters: structuredClone(method.inputSchema),
          ...(featureModule.manifest.agentCapability ? {
            frameworkCapability: structuredClone(featureModule.manifest.agentCapability),
          } : {}),
        },
      }] : []));
  }

  resolveAgentTool(name: string): AgentToolBinding {
    const binding = this.listAgentTools().find(candidate => candidate.definition.name === name);
    if (!binding) {
      throw routerError('FEATURE_AGENT_TOOL_UNAVAILABLE', 'not_found',
        'Agent 工具未注册到中心路由');
    }
    return binding;
  }

  listManifests(context: CollaborationContext): FeatureManifest[] {
    return [...this.modules.values()]
      .filter(featureModule => context.enabledFeatures.has(featureModule.manifest.id))
      .map(featureModule => visibleManifest(featureModule.manifest, context))
      .filter(manifest => manifest.methods.length > 0 || manifest.observation !== undefined);
  }

  agentAccess(feature: CollaborationFeature, methodId: string): {
    tool: string;
    permission: CollaborationPermission;
  } {
    const method = this.modules.get(feature)?.manifest.methods
      .find(candidate => candidate.id === methodId);
    if (!method || !method.audiences.includes('agent') || !method.agentTool) {
      throw routerError('FEATURE_AGENT_METHOD_UNAVAILABLE', 'permission',
        '此功能调用口未向 Agent 开放', feature);
    }
    return { tool: method.agentTool.name, permission: method.permission };
  }

  private assertUniqueAgentTools(featureModule: FeatureModule): void {
    const existing = new Set(this.listAgentTools().map(binding => binding.definition.name));
    for (const method of featureModule.manifest.methods) {
      if (!method.agentTool) continue;
      if (existing.has(method.agentTool.name)) {
        throw routerError('FEATURE_AGENT_TOOL_DUPLICATE', 'conflict',
          'Agent 工具重复注册', featureModule.manifest.id);
      }
      existing.add(method.agentTool.name);
    }
  }

  async snapshot(
    input: ObservationQueryInput,
    context: CollaborationContext,
  ): Promise<CollaborationSnapshot> {
    const manifests = this.listManifests(context);
    for (const manifest of manifests) {
      if (!manifest.observation) continue;
      const query = resolveObservationQuery(input, manifest.observation.budget);
      if (!manifest.observation.views.includes(query.view)) throw routerError(
        'OBSERVATION_VIEW_UNSUPPORTED', 'not_found', '功能模组不支持该状态视图', manifest.id,
      );
    }
    // Keep failed islands visible as partial facts; an empty success would conceal a broken source.
    const settled = await Promise.allSettled(manifests.map(manifest =>
      manifest.observation ? this.observe(manifest.id, input, context) : Promise.resolve(undefined)));
    const features: CollaborationFeatureSnapshot[] = manifests.map((manifest, index) => {
      const outcome = settled[index]!;
      return {
        id: manifest.id, version: manifest.version, title: manifest.title,
        methods: manifest.methods.map(method => ({
          id: method.id, kind: method.kind, permission: method.permission, outputMode: method.output.mode,
        })),
        ...(outcome.status === 'fulfilled'
          ? outcome.value ? { observation: outcome.value } : {}
          : { observationFailure: snapshotFailure(outcome.reason) }),
      };
    });
    const revisions = features.map(feature => [feature.id,
      feature.observation?.revision ?? null, feature.observationFailure?.code ?? null]);
    return {
      schemaVersion: 1,
      revision: createHash('sha256').update(JSON.stringify(revisions)).digest('hex'),
      observedAt: new Date().toISOString(),
      completeness: features.some(feature => feature.observationFailure
        || feature.observation?.completeness === 'partial')
        ? 'partial' : 'complete',
      features,
    };
  }

  async invoke(call: ModuleCall, context: CollaborationContext): Promise<unknown> {
    assertEnabled(call.feature, context);
    const featureModule = this.modules.get(call.feature);
    if (!featureModule) {
      throw routerError('FEATURE_MODULE_UNAVAILABLE', 'not_found', '功能模组尚未注册', call.feature);
    }
    const method = featureModule.manifest.methods.find(candidate => candidate.id === call.method);
    if (!method) {
      throw routerError('FEATURE_METHOD_UNAVAILABLE', 'not_found', '功能调用口不存在', call.feature);
    }
    assertCallable(method, context, call.feature);
    const handler = featureModule.handlers[method.id]!;
    const input = parseInput(handler, call.input, call.feature, method.id);
    const budget = resolveOutputBudget(method.output.budget, call.budget);
    const output = await handler.invoke({ ...context, budget }, input);
    // An operation handle is accepted only after its owning fact port can inspect it.
    return method.output.mode === 'operation'
      ? verifiedModuleOperation(output, featureModule.operations!, call.feature, method.id)
      : output;
  }

  async observe(
    feature: CollaborationFeature,
    input: ObservationQueryInput,
    context: CollaborationContext,
  ): Promise<ObservationEnvelope> {
    assertEnabled(feature, context);
    const featureModule = this.modules.get(feature);
    if (!featureModule) {
      throw routerError('FEATURE_MODULE_UNAVAILABLE', 'not_found', '功能模组尚未注册', feature);
    }
    const manifest = featureModule.manifest.observation;
    if (!manifest || !featureModule.observation) {
      throw routerError('FEATURE_OBSERVATION_UNAVAILABLE', 'not_found', '功能模组未提供状态观察口', feature);
    }
    assertObservationCallable(manifest, context, feature);
    const query = resolveObservationQuery(input, manifest.budget);
    if (!manifest.views.includes(query.view)) {
      throw routerError('OBSERVATION_VIEW_UNSUPPORTED', 'not_found', '功能模组不支持该状态视图', feature);
    }
    const page = observationOutput(
      await featureModule.observation.query(context, query)
        .catch(error => observationSourceError(error, feature)), feature, query, context.audience,
    );
    return {
      schemaVersion: 1, view: query.view, observedAt: new Date().toISOString(),
      completeness: page.truncated || page.contentTruncated ? 'partial' : 'complete', ...structuredClone(page),
    };
  }

  async inspectOperation(
    feature: CollaborationFeature,
    identity: OperationIdentity,
    context: CollaborationContext,
  ): Promise<ProbeItem> {
    assertEnabled(feature, context);
    assertPermission('observe', context, feature);
    const featureModule = this.modules.get(feature);
    if (!featureModule) {
      throw routerError('FEATURE_MODULE_UNAVAILABLE', 'not_found', '功能模组尚未注册', feature);
    }
    if (!featureModule.operations) {
      throw routerError(
        'FEATURE_OPERATION_INSPECTION_UNAVAILABLE', 'not_found', '功能模组未提供运行事实口', feature,
      );
    }
    const fact = await inspectOperationFact(
      featureModule.operations, feature, 'inspectOperation', identity,
    );
    if (!fact) {
      throw routerError('FEATURE_OPERATION_NOT_FOUND', 'not_found', '运行句柄不存在或已被更新', feature);
    }
    return selectProbe(fact, { audience: context.audience });
  }

  async waitOperation(
    feature: CollaborationFeature,
    identity: OperationIdentity,
    context: CollaborationContext,
    timeoutMs: number,
  ): Promise<OperationWaitResult> {
    assertEnabled(feature, context);
    assertPermission('observe', context, feature);
    const featureModule = this.modules.get(feature);
    if (!featureModule) {
      throw routerError('FEATURE_MODULE_UNAVAILABLE', 'not_found', '功能模组尚未注册', feature);
    }
    if (!featureModule.operations) {
      throw routerError(
        'FEATURE_OPERATION_INSPECTION_UNAVAILABLE', 'not_found', '功能模组未提供运行事实口', feature,
      );
    }
    const result = await waitForOperation(
      featureModule.operations, feature, identity, timeoutMs, context.signal,
    );
    return { ...result, fact: selectProbe(result.fact, { audience: context.audience }) };
  }

  async listOperationRecords(
    feature: CollaborationFeature, input: RecordListInput, context: CollaborationContext,
  ) {
    return listOperationRecords(this.modules, feature, input, context);
  }

  async latestAgentRecords(agentIds: string[], context: CollaborationContext) {
    return latestAgentRecords(this.modules, agentIds, context);
  }

  async readOperationRecord(
    feature: CollaborationFeature, identity: OperationIdentity,
    input: RecordReadInput, context: CollaborationContext,
  ) {
    return readOperationRecord(this.modules, feature, identity, input, context);
  }
}

function snapshotFailure(error: unknown): { code: string; kind: string; message: string } {
  const known = frameworkErrorFromUnknown(error, 'collaboration.snapshot');
  return { code: known.code === 'INTERNAL_ERROR' ? 'FEATURE_OBSERVATION_FAILED' : known.code,
    kind: known.kind, message: '状态不可读取' };
}

async function verifiedModuleOperation(
  output: unknown,
  operations: NonNullable<FeatureModule['operations']>,
  feature: CollaborationFeature,
  method: string,
): Promise<unknown> {
  if (output instanceof AgentToolOutput) {
    const value = await verifiedOperationOutput(output.value, operations, feature, method);
    return new AgentToolOutput(value, output.meta);
  }
  return verifiedOperationOutput(output, operations, feature, method);
}
