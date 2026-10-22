export class ProviderConfigurationError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message); this.name = 'ProviderConfigurationError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
