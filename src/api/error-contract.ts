export const FRAMEWORK_ERROR_KINDS = [
  'validation', 'not_found', 'conflict', 'permission', 'cancelled',
  'provider', 'protocol', 'timeout', 'tool', 'io', 'internal',
] as const;

export type FrameworkErrorKind = typeof FRAMEWORK_ERROR_KINDS[number];

export interface ClientErrorData {
  message: string;
  code?: string;
  kind?: FrameworkErrorKind;
}

export class ClientFrameworkError extends Error {
  readonly code?: string;
  readonly kind?: FrameworkErrorKind;

  constructor(data: ClientErrorData, options?: ErrorOptions) {
    super(data.message, options);
    this.name = 'ClientFrameworkError';
    this.code = data.code;
    this.kind = data.kind;
  }
}

const ERROR_KIND_SET = new Set<string>(FRAMEWORK_ERROR_KINDS);

export function readErrorPayload(value: unknown, fallback: string): ClientErrorData {
  if (typeof value === 'string') return { message: value.trim() || fallback };
  if (!isRecord(value)) return { message: fallback };
  const message = nonEmptyString(value.message) ?? nonEmptyString(value.error) ?? fallback;
  const code = nonEmptyString(value.code) ?? nonEmptyString(value.errorCode);
  const rawKind = nonEmptyString(value.kind) ?? nonEmptyString(value.errorKind);
  const kind = rawKind && ERROR_KIND_SET.has(rawKind) ? rawKind as FrameworkErrorKind : undefined;
  return { message, ...(code ? { code } : {}), ...(kind ? { kind } : {}) };
}

export function errorMessage(value: unknown, fallback: string): string {
  return readErrorPayload(value, fallback).message;
}

export function errorFromPayload(value: unknown, fallback: string, cause?: unknown): ClientFrameworkError {
  return new ClientFrameworkError(readErrorPayload(value, fallback), cause === undefined ? undefined : { cause });
}

export async function errorFromResponse(response: Response, fallback = `HTTP ${response.status}`): Promise<ClientFrameworkError> {
  const text = await response.text().catch(() => '');
  if (!text) return errorFromPayload(undefined, fallback);
  try {
    return errorFromPayload(JSON.parse(text), fallback);
  } catch {
    return errorFromPayload(text, fallback);
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
