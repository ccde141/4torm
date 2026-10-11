import type {
  CollaborationContext, CollaborationFeature, FeatureModule,
} from './contracts.js';
import { assertEnabled, assertPermission, parseInput, routerError } from './router-guards.js';

export async function prepareFeatureTransport(
  modules: ReadonlyMap<CollaborationFeature, FeatureModule>,
  feature: CollaborationFeature, portId: string, input: unknown,
  context: CollaborationContext,
): Promise<unknown> {
  assertEnabled(feature, context);
  const featureModule = modules.get(feature);
  if (!featureModule) throw routerError(
    'FEATURE_MODULE_UNAVAILABLE', 'not_found', '功能模组尚未注册', feature,
  );
  const port = featureModule.manifest.transports?.find(item => item.id === portId);
  const handler = featureModule.transports?.[portId];
  if (!port || !handler) throw routerError(
    'FEATURE_TRANSPORT_UNAVAILABLE', 'not_found', '传输调用口不存在', feature,
  );
  if (!port.audiences.includes(context.audience)) throw routerError(
    'CAPABILITY_AUDIENCE_DENIED', 'permission', '此调用口不向当前调用方开放', feature,
  );
  assertPermission(port.permission, context, feature);
  return handler.prepare(context, parseInput(handler, input, feature, portId));
}
