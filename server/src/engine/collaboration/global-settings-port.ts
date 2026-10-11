import type { CollaborationContext } from './contracts.js';
import { routerError } from './router-guards.js';

export type GlobalSettingsMethod = 'readCompaction' | 'writeCompaction' | 'testCompactionModel';
export interface GlobalSettingsPort {
  invoke(method: GlobalSettingsMethod, input: unknown, context: CollaborationContext): Promise<unknown>;
}

/** A host-level control port; it is deliberately absent from Agent capability registration. */
export function invokeGlobalSettings(port: GlobalSettingsPort | undefined,
  method: GlobalSettingsMethod, input: unknown, context: CollaborationContext): Promise<unknown> {
  if (context.audience === 'agent' || !context.permissions.has('administer')) {
    throw routerError('GLOBAL_SETTINGS_DENIED', 'permission', '当前调用方不能更改全局设置');
  }
  if (!port) throw routerError('GLOBAL_SETTINGS_UNAVAILABLE', 'not_found', '全局设置调用口未注册');
  return port.invoke(method, input, context);
}
