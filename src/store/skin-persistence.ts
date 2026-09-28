import { writeJson } from './skin-helpers';
import type { SkinConfig } from './skin';

let pending: Promise<void> = Promise.resolve();

/** Serialize skin writes so an older debounced save cannot overwrite a newer video choice. */
export function persistSkinConfig(config: SkinConfig): Promise<void> {
  const next = pending.catch(() => {}).then(() => writeJson('skin-config.json', config));
  pending = next;
  return next;
}
