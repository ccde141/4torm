export type ModelCapability = 'tools' | 'vision';
export type CapabilityStatus = 'supported' | 'unsupported';

export interface CapabilityProbe {
  status: CapabilityStatus;
  checkedAt: string;
  method?: string;
}

export interface ModelCapabilities {
  tools?: CapabilityProbe;
  vision?: CapabilityProbe;
}

export type ModelCapabilityMap = Record<string, ModelCapabilities>;

export const TOOL_TRANSPORT_PROBE_VERSION = 2;
export type ToolTransportStatus = 'native-confirmed' | 'text-required';

export interface ToolTransportIdentity {
  providerId: string;
  baseUrl: string;
  protocol: string;
  model: string;
  profile: string;
}

export interface ToolTransportProbe {
  status: ToolTransportStatus;
  checkedAt: string;
  fingerprint: string;
}

export type ToolTransportMap = Record<string, ToolTransportProbe>;

interface CapabilitySource {
  modelCapabilities?: ModelCapabilityMap;
  nativeProbe?: Record<string, { native: boolean; probedAt: string }>;
  toolTransports?: ToolTransportMap;
}

function normalizeBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return baseUrl.trim().replace(/\/+$/, '');
  }
}

export function buildToolTransportFingerprint(identity: ToolTransportIdentity): string {
  return JSON.stringify([
    identity.providerId,
    normalizeBaseUrl(identity.baseUrl),
    identity.protocol,
    identity.model,
    identity.profile,
    TOOL_TRANSPORT_PROBE_VERSION,
  ]);
}

export function readToolTransport(
  provider: CapabilitySource,
  identity: ToolTransportIdentity,
): ToolTransportProbe | undefined {
  const probe = provider.toolTransports?.[identity.model];
  return probe?.fingerprint === buildToolTransportFingerprint(identity) ? probe : undefined;
}

export function readModelCapability(
  provider: CapabilitySource,
  model: string,
  capability: ModelCapability,
): CapabilityProbe | undefined {
  const current = provider.modelCapabilities?.[model]?.[capability];
  if (current) {
    if (capability === 'tools' && current.status === 'unsupported' && !current.method) return undefined;
    return current;
  }
  if (capability !== 'tools') return undefined;
  const legacy = provider.nativeProbe?.[model];
  return legacy?.native ? {
    status: 'supported',
    checkedAt: legacy.probedAt,
  } : undefined;
}

export function writeModelCapability(
  source: ModelCapabilityMap | undefined,
  model: string,
  capability: ModelCapability,
  probe: CapabilityProbe,
): ModelCapabilityMap {
  return {
    ...source,
    [model]: { ...source?.[model], [capability]: probe },
  };
}

export function retainModelCapabilities(
  source: ModelCapabilityMap | undefined,
  models: string[],
): ModelCapabilityMap | undefined {
  return retainModelRecords(source, models);
}

function retainModelRecords<T>(
  source: Record<string, T> | undefined,
  models: string[],
): Record<string, T> | undefined {
  if (!source) return undefined;
  const allowed = new Set(models);
  return Object.fromEntries(Object.entries(source).filter(([model]) => allowed.has(model)));
}

export function retainProviderCapabilities(
  provider: CapabilitySource,
  models: string[],
): Pick<CapabilitySource, 'modelCapabilities' | 'nativeProbe' | 'toolTransports'> {
  return {
    modelCapabilities: retainModelRecords(provider.modelCapabilities, models),
    nativeProbe: retainModelRecords(provider.nativeProbe, models),
    toolTransports: retainModelRecords(provider.toolTransports, models),
  };
}
