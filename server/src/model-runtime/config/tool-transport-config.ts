import fs from 'node:fs/promises';
import { providersFile } from '../../services/data-paths.js';
import {
  resolveToolTransportContract,
  type ToolTransportContract,
  type ToolTransportProvider,
} from './tool-transport-contract.js';

/** Read the configured provider once, then derive the runtime's transport identity. */
export async function readToolTransportContract(
  dataDir: string,
  providerId: string,
  model: string,
): Promise<ToolTransportContract | null> {
  const source: unknown = JSON.parse(await fs.readFile(providersFile(dataDir), 'utf8'));
  if (!source || typeof source !== 'object' || !Array.isArray((source as { providers?: unknown }).providers)) {
    throw new Error('Provider configuration is invalid');
  }
  const providers = (source as { providers: unknown[] }).providers;
  const provider = providers.find(value => value && typeof value === 'object'
    && (value as { id?: unknown }).id === providerId) as ToolTransportProvider | undefined;
  if (!provider) return null;
  if (typeof provider.baseUrl !== 'string') throw new Error('Provider baseUrl is invalid');
  return resolveToolTransportContract(provider, model);
}
