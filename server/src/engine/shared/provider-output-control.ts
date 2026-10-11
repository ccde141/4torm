import type { ProviderModelIdentity } from '../../model-runtime/contracts/provider-adapter.js';
import { resolveProviderAdapter } from '../../model-runtime/providers/registry.js';

/** Local generation limits finish normally; they do not represent a user cancellation. */
export interface ProviderOutputControl {
  shouldStop?: () => boolean;
  preferBody?: boolean;
  allowEmptyAtLimit?: boolean;
}

/** Apply after custom parameter merging, without inventing unsupported provider switches. */
export function applyProviderOutputControl(
  body: Record<string, unknown>,
  identity: ProviderModelIdentity,
  control?: ProviderOutputControl,
): void {
  if (control?.preferBody) resolveProviderAdapter(identity).disableThinking?.(body, identity);
}
