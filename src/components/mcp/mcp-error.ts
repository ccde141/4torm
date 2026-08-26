import type { MessageKey, MessageValues } from '../../i18n/locale';
import { McpFormError } from './mcp-form';

type Translate = (key: MessageKey, values?: MessageValues) => string;

export function mcpErrorMessage(reason: unknown, t: Translate): string {
  if (reason instanceof McpFormError) {
    return t(`mcp.error.${reason.code}` as MessageKey, reason.values);
  }
  return reason instanceof Error ? reason.message : String(reason);
}
