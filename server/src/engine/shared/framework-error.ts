export const FRAMEWORK_ERROR_KINDS = [
  'validation',
  'not_found',
  'conflict',
  'permission',
  'cancelled',
  'provider',
  'protocol',
  'timeout',
  'tool',
  'io',
  'internal',
] as const;

export type FrameworkErrorKind = typeof FRAMEWORK_ERROR_KINDS[number];

export interface FrameworkErrorData {
  code: string;
  kind: FrameworkErrorKind;
  message: string;
  source: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface FrameworkHttpError {
  statusCode: number;
  body: {
    error: string;
    errorCode: string;
    errorKind: FrameworkErrorKind;
  };
}

export interface FrameworkSseError {
  type: 'error';
  message: string;
  code: string;
  kind: FrameworkErrorKind;
}

const ERROR_KIND_SET = new Set<string>(FRAMEWORK_ERROR_KINDS);

const HTTP_STATUS_BY_KIND: Record<FrameworkErrorKind, number> = {
  validation: 400,
  not_found: 404,
  conflict: 409,
  permission: 403,
  cancelled: 409,
  provider: 502,
  protocol: 502,
  timeout: 504,
  tool: 500,
  io: 500,
  internal: 500,
};

export class FrameworkError extends Error {
  readonly data: FrameworkErrorData;

  constructor(data: FrameworkErrorData, options?: ErrorOptions) {
    super(data.message, options);
    this.name = 'FrameworkError';
    this.data = data;
  }
}

export function frameworkError(data: FrameworkErrorData, options?: ErrorOptions): FrameworkError {
  return new FrameworkError(data, options);
}

export function frameworkErrorFromUnknown(error: unknown, source: string): FrameworkErrorData {
  if (error instanceof FrameworkError) return error.data;
  if (isFrameworkErrorData(error)) return error;
  return {
    code: 'INTERNAL_ERROR',
    kind: 'internal',
    message: '服务器内部错误',
    source,
    retryable: false,
  };
}

export function frameworkErrorToHttp(error: FrameworkError | FrameworkErrorData): FrameworkHttpError {
  const data = error instanceof FrameworkError ? error.data : error;
  return {
    statusCode: HTTP_STATUS_BY_KIND[data.kind],
    body: {
      error: data.message,
      errorCode: data.code,
      errorKind: data.kind,
    },
  };
}

export function frameworkErrorToSse(error: FrameworkError | FrameworkErrorData): FrameworkSseError {
  const data = error instanceof FrameworkError ? error.data : error;
  return { type: 'error', message: data.message, code: data.code, kind: data.kind };
}

export function isFrameworkErrorData(value: unknown): value is FrameworkErrorData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Partial<FrameworkErrorData>;
  return typeof data.code === 'string'
    && data.code.length > 0
    && typeof data.kind === 'string'
    && ERROR_KIND_SET.has(data.kind)
    && typeof data.message === 'string'
    && data.message.length > 0
    && typeof data.source === 'string'
    && data.source.length > 0
    && typeof data.retryable === 'boolean'
    && (data.details === undefined || isRecord(data.details));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
