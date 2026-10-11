import type { FastifyInstance, FastifyRequest } from 'fastify';
import { frameworkError } from '../engine/shared/framework-error.js';
import {
  COLLABORATION_FEATURES, COLLABORATION_PERMISSIONS,
  type CollaborationContext, type CollaborationFeature,
  type CollaborationPermission,
} from '../engine/collaboration/contracts.js';

export interface HumanPrincipal {
  id: string;
  enabledFeatures: readonly CollaborationFeature[];
  permissions: readonly CollaborationPermission[];
}

/** Replace this port when accounts are introduced; HTTP callers never supply their own actor. */
export interface HumanIdentityPort {
  resolve(request: FastifyRequest): HumanPrincipal | null;
}

// 无账号模式把到达本机 HTTP 服务的调用者视为人；必须与 loopback 监听边界一起使用。
const LOCAL_IDENTITY: HumanIdentityPort = {
  resolve: () => ({ id: 'local-human', enabledFeatures: COLLABORATION_FEATURES,
    permissions: COLLABORATION_PERMISSIONS }),
};

type IdentityServer = FastifyInstance & { humanIdentityPort?: HumanIdentityPort };

export function installHumanIdentityPort(
  app: FastifyInstance, port: HumanIdentityPort = LOCAL_IDENTITY,
): void {
  app.decorate('humanIdentityPort', port);
}

export function humanContext(request: FastifyRequest): CollaborationContext {
  const port = (request.server as IdentityServer).humanIdentityPort ?? LOCAL_IDENTITY;
  const principal = port.resolve(request);
  if (!principal || !validPrincipal(principal)) throw frameworkError({
    code: 'HUMAN_IDENTITY_UNAVAILABLE', kind: 'permission',
    message: '无法确认当前人类调用身份', source: 'collaboration.identity', retryable: false,
  });
  return {
    actor: { type: 'human', id: principal.id, actingAs: 'human' },
    audience: 'human', enabledFeatures: new Set(principal.enabledFeatures),
    permissions: new Set(principal.permissions), requestId: request.id,
  };
}

function validPrincipal(value: HumanPrincipal): boolean {
  return typeof value.id === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value.id)
    && Array.isArray(value.enabledFeatures)
    && value.enabledFeatures.every(feature => COLLABORATION_FEATURES.includes(feature))
    && Array.isArray(value.permissions)
    && value.permissions.every(permission => COLLABORATION_PERMISSIONS.includes(permission));
}
