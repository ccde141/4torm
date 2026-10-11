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

export type ToolTransportStatus = 'native-confirmed' | 'text-required';

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
