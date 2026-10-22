import {
  resolveToolTransportContract,
  type ToolTransportContract,
} from './tool-transport-contract.js';
import { readProviderDocument } from './provider-store.js';

/** Read the configured provider once, then derive the runtime's transport identity. */
export async function readToolTransportContract(
  dataDir: string,
  providerId: string,
  model: string,
): Promise<ToolTransportContract | null> {
  const { providers } = await readProviderDocument(dataDir);
  const provider = providers.find(value => value.id === providerId);
  if (!provider) return null;
  return resolveToolTransportContract(provider, model);
}
