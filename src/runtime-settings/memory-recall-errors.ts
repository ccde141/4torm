import type { MessageKey } from '../i18n/locale';

const KEYS: Record<string, MessageKey> = {
  MEMORY_RECALL_SETTINGS_INVALID: 'recall.error.settings',
  MEMORY_RECALL_SETTINGS_CORRUPT: 'recall.error.corrupt',
  MEMORY_RECALL_MODEL_UNAVAILABLE: 'recall.error.unavailable',
  MEMORY_RECALL_MODEL_NOT_CONFIGURED: 'recall.error.unconfigured',
  MEMORY_RECALL_OUTPUT_INVALID: 'recall.error.output',
  MEMORY_RECALL_INPUT_INVALID: 'recall.error.input',
  MEMORY_RECALL_VERIFICATION_FAILED: 'recall.error.verification',
  MEMORY_RECALL_RESPONSE_INVALID: 'recall.error.response',
  MEMORY_RECALL_EMBEDDING_FAILED: 'recall.error.embedding',
  MEMORY_RECALL_SOURCE_UNAVAILABLE: 'recall.error.source',
  MEMORY_RECALL_READ_BUDGET_EXHAUSTED: 'recall.error.budget',
  MEMORY_RECALL_SEARCH_INCOMPLETE: 'recall.error.incomplete',
};

export function memoryRecallError(error: unknown, t: (key: MessageKey) => string): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return KEYS[code] ? t(KEYS[code]) : error instanceof Error ? error.message : String(error);
}
