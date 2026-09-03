import {
  FrameworkError,
  frameworkErrorFromUnknown,
  frameworkErrorToHttp,
  frameworkErrorToSse,
  isFrameworkErrorData,
  type FrameworkErrorData,
  type FrameworkHttpError,
  type FrameworkSseError,
} from './framework-error.js';

interface StatusError extends Error {
  statusCode?: number;
}

const CLIENT_STATUS: Record<number, Pick<FrameworkErrorData, 'code' | 'kind' | 'retryable'>> = {
  400: { code: 'HTTP_BAD_REQUEST', kind: 'validation', retryable: false },
  401: { code: 'HTTP_UNAUTHORIZED', kind: 'permission', retryable: false },
  403: { code: 'HTTP_FORBIDDEN', kind: 'permission', retryable: false },
  404: { code: 'HTTP_NOT_FOUND', kind: 'not_found', retryable: false },
  408: { code: 'HTTP_TIMEOUT', kind: 'timeout', retryable: false },
  409: { code: 'HTTP_CONFLICT', kind: 'conflict', retryable: false },
  422: { code: 'HTTP_UNPROCESSABLE', kind: 'validation', retryable: false },
  429: { code: 'HTTP_RATE_LIMITED', kind: 'provider', retryable: true },
};

function abortError(source: string): FrameworkErrorData {
  return {
    code: 'REQUEST_ABORTED', kind: 'cancelled', message: '请求已中止',
    source, retryable: false,
  };
}

function clientStatusError(error: StatusError, source: string): FrameworkErrorData | undefined {
  const status = error.statusCode;
  if (!status || status < 400 || status >= 500) return undefined;
  const mapped = CLIENT_STATUS[status] ?? {
    code: `HTTP_${status}`, kind: 'validation' as const, retryable: false,
  };
  return { ...mapped, message: error.message || '请求无效', source };
}

export function frameworkTransportErrorFromUnknown(
  error: unknown,
  source: string,
): FrameworkErrorData {
  if (error instanceof FrameworkError || isFrameworkErrorData(error)) {
    return frameworkErrorFromUnknown(error, source);
  }
  if (error instanceof Error && error.name === 'AbortError') return abortError(source);
  if (error instanceof Error) {
    const statusError = clientStatusError(error as StatusError, source);
    if (statusError) return statusError;
  }
  return frameworkErrorFromUnknown(error, source);
}

export function frameworkHttpErrorFromUnknown(
  error: unknown,
  source: string,
): FrameworkHttpError {
  return frameworkErrorToHttp(frameworkTransportErrorFromUnknown(error, source));
}

export function frameworkSseErrorFromUnknown(
  error: unknown,
  source: string,
): FrameworkSseError {
  return frameworkErrorToSse(frameworkTransportErrorFromUnknown(error, source));
}
