import { FrameworkError, frameworkError } from '../shared/framework-error.js';
import {
  validateBudgetPolicy,
  validateObservationBudgetPolicy,
} from './budget.js';
import type {
  CollaborationContext,
  CollaborationFeature,
  CollaborationPermission,
  FeatureManifest,
  FeatureModule,
  ModuleMethodHandler,
  ModuleMethodManifest,
  ObservationPortManifest,
} from './contracts.js';

export function validateModule(featureModule: FeatureModule): void {
  const methodIds = featureModule.manifest.methods.map(method => method.id);
  const declared = new Set(methodIds);
  if (declared.size !== methodIds.length) {
    throw routerError('FEATURE_METHOD_DUPLICATE', 'conflict',
      '功能调用口重复声明', featureModule.manifest.id);
  }
  for (const method of featureModule.manifest.methods) validateMethod(featureModule, method);
  validateAgentCapability(featureModule);
  validateOperationPort(featureModule);
  validateObservationPort(featureModule);
  validateTransportPorts(featureModule);
  const undeclared = Object.keys(featureModule.handlers).find(id => !declared.has(id));
  if (undeclared) throw routerError('FEATURE_HANDLER_UNDECLARED', 'internal',
    '功能处理器未在清单中声明', featureModule.manifest.id);
}

function validateTransportPorts(featureModule: FeatureModule): void {
  const declared = featureModule.manifest.transports ?? [];
  const ids = new Set(declared.map(port => port.id));
  if (ids.size !== declared.length) throw routerError(
    'FEATURE_TRANSPORT_DUPLICATE', 'conflict', '传输调用口重复声明', featureModule.manifest.id,
  );
  for (const port of declared) {
    if (!featureModule.transports?.[port.id]) throw routerError(
      'FEATURE_TRANSPORT_HANDLER_MISSING', 'internal',
      '传输调用口缺少处理器', featureModule.manifest.id,
    );
  }
  if (Object.keys(featureModule.transports ?? {}).some(id => !ids.has(id))) throw routerError(
    'FEATURE_TRANSPORT_HANDLER_UNDECLARED', 'internal',
    '传输处理器未在清单中声明', featureModule.manifest.id,
  );
}

function validateAgentCapability(featureModule: FeatureModule): void {
  const tools = featureModule.manifest.methods.filter(method => method.agentTool !== undefined);
  const capability = featureModule.manifest.agentCapability;
  if (tools.length > 0 && !capability) throw routerError(
    'FEATURE_AGENT_CAPABILITY_MISSING', 'internal',
    'Agent 工具缺少功能岛能力说明', featureModule.manifest.id,
  );
  if (tools.length === 0 && capability) throw routerError(
    'FEATURE_AGENT_CAPABILITY_ORPHANED', 'internal',
    '功能岛能力说明没有对应 Agent 工具', featureModule.manifest.id,
  );
  if (capability && (capability.id !== featureModule.manifest.id
    || !capability.title.trim() || !capability.route.trim() || !capability.guidance.trim())) {
    throw routerError('FEATURE_AGENT_CAPABILITY_INVALID', 'internal',
      '功能岛能力说明与模块身份不一致', featureModule.manifest.id);
  }
}

function validateMethod(featureModule: FeatureModule, method: ModuleMethodManifest): void {
  if (!featureModule.handlers[method.id]) throw routerError(
    'FEATURE_HANDLER_MISSING', 'internal', '功能调用口缺少处理器', featureModule.manifest.id,
  );
  if (method.output.budget) validateBudgetPolicy(method.output.budget);
  if (method.agentTool !== undefined
    && (!method.audiences.includes('agent')
      || method.agentTool.name.trim().length === 0
      || method.agentTool.description.trim().length === 0)) {
    throw routerError('FEATURE_AGENT_TOOL_INVALID', 'internal',
      'Agent 工具归属与调用口受众不一致', featureModule.manifest.id);
  }
  if (method.audiences.includes('agent') && method.agentTool === undefined) {
    throw routerError('FEATURE_AGENT_TOOL_MISSING', 'internal',
      'Agent 调用口缺少固定工具归属', featureModule.manifest.id);
  }
}

function validateOperationPort(featureModule: FeatureModule): void {
  const declared = featureModule.manifest.methods.some(method => method.output.mode === 'operation')
    || featureModule.manifest.operation?.inspect === true;
  if (declared && !featureModule.operations) throw routerError(
    'FEATURE_OPERATION_HANDLER_MISSING', 'internal',
    '运行型调用缺少事实确认口', featureModule.manifest.id,
  );
  if (!declared && featureModule.operations) throw routerError(
    'FEATURE_OPERATION_HANDLER_UNDECLARED', 'internal',
    '事实确认口没有对应的运行型调用', featureModule.manifest.id,
  );
  if (featureModule.manifest.operation?.wait === true && !featureModule.operations?.subscribe) {
    throw routerError('FEATURE_OPERATION_WAIT_HANDLER_MISSING', 'internal',
      '运行等待声明缺少变化通知口', featureModule.manifest.id);
  }
  if (featureModule.operations?.subscribe && featureModule.manifest.operation?.wait !== true) {
    throw routerError('FEATURE_OPERATION_WAIT_HANDLER_UNDECLARED', 'internal',
      '运行变化通知口未在清单中声明', featureModule.manifest.id);
  }
  if (Boolean(featureModule.manifest.operation?.records) !== Boolean(featureModule.records)) {
    throw routerError('FEATURE_RECORD_PORT_MISMATCH', 'internal',
      '运行记录声明与处理器不一致', featureModule.manifest.id);
  }
}

function validateObservationPort(featureModule: FeatureModule): void {
  const manifest = featureModule.manifest.observation;
  if (manifest) {
    if (!featureModule.observation) throw routerError(
      'FEATURE_OBSERVATION_HANDLER_MISSING', 'internal',
      '状态观察口缺少处理器', featureModule.manifest.id,
    );
    validateObservationBudgetPolicy(manifest.budget);
  } else if (featureModule.observation) {
    throw routerError('FEATURE_OBSERVATION_HANDLER_UNDECLARED', 'internal',
      '状态观察处理器未在清单中声明', featureModule.manifest.id);
  }
}

export function visibleManifest(
  manifest: FeatureManifest,
  context: CollaborationContext,
): FeatureManifest {
  const methods = manifest.methods.filter(method => isCallable(method, context));
  const observation = manifest.observation && isObservationCallable(manifest.observation, context)
    ? manifest.observation : undefined;
  return structuredClone({ ...manifest, methods, observation });
}

export function assertObservationCallable(
  port: ObservationPortManifest,
  context: CollaborationContext,
  feature: CollaborationFeature,
): void {
  if (!port.audiences.includes(context.audience)) throw routerError(
    'CAPABILITY_AUDIENCE_DENIED', 'permission', '此调用口不向当前调用方开放', feature,
  );
  assertPermission(port.permission, context, feature);
}

function isObservationCallable(
  port: ObservationPortManifest,
  context: CollaborationContext,
): boolean {
  return port.audiences.includes(context.audience) && context.permissions.has(port.permission);
}

export function assertEnabled(
  feature: CollaborationFeature,
  context: CollaborationContext,
): void {
  if (context.enabledFeatures.has(feature)) return;
  throw routerError('CAPABILITY_DISABLED', 'permission',
    '当前 Agent 未启用此框架能力', feature);
}

export function assertCallable(
  method: ModuleMethodManifest,
  context: CollaborationContext,
  feature: CollaborationFeature,
): void {
  if (!method.audiences.includes(context.audience)) throw routerError(
    'CAPABILITY_AUDIENCE_DENIED', 'permission', '此调用口不向当前调用方开放', feature,
  );
  assertPermission(method.permission, context, feature);
}

function isCallable(method: ModuleMethodManifest, context: CollaborationContext): boolean {
  return method.audiences.includes(context.audience) && context.permissions.has(method.permission);
}

export function assertPermission(
  permission: CollaborationPermission,
  context: CollaborationContext,
  feature: CollaborationFeature,
): void {
  if (context.permissions.has(permission)) return;
  throw routerError('CAPABILITY_PERMISSION_DENIED', 'permission',
    '当前调用方没有执行此操作的权限', feature);
}

export function parseInput(
  handler: Pick<ModuleMethodHandler, 'parse'>,
  input: unknown,
  feature: CollaborationFeature,
  method: string,
): unknown {
  try {
    return handler.parse(input);
  } catch (error) {
    if (error instanceof FrameworkError) throw error;
    throw frameworkError({ code: 'FEATURE_INPUT_INVALID', kind: 'validation',
      message: '功能调用参数无效', source: 'collaboration.router', retryable: false,
      details: { feature, method } }, { cause: error });
  }
}

export function routerError(
  code: string,
  kind: 'conflict' | 'not_found' | 'permission' | 'internal',
  message: string,
  feature?: CollaborationFeature,
) {
  return frameworkError({ code, kind, message, source: 'collaboration.router', retryable: false,
    ...(feature ? { details: { feature } } : {}) });
}
