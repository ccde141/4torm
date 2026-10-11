import type { useLocale } from '../../../i18n/LocaleContext';

let idCounter = 0;

export function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${(idCounter++).toString(36)}`;
}

export function getDefaultLabel(type: string, t: ReturnType<typeof useLocale>['t']): string {
  const map: Record<string, Parameters<typeof t>[0]> = {
    entry: 'tradewind.canvas.node.entry', output: 'tradewind.canvas.node.output',
    agent: 'tradewind.canvas.node.agent', meeting: 'tradewind.canvas.node.meeting',
    note: 'tradewind.canvas.node.note', 'human-gate': 'tradewind.canvas.node.gate',
  };
  return map[type] ? t(map[type]) : type;
}

export function getDefaultConfig(type: string): Record<string, unknown> {
  switch (type) {
    case 'agent': return { agentId: '' };
    case 'meeting': return { chairAgentId: '', participantNodeIds: [] };
    case 'note': return { content: '' };
    default: return {};
  }
}
