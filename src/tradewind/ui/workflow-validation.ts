import type { WorkflowGraph, WorkflowMode } from '../types';
import type { MessageKey, MessageValues } from '../../i18n/locale';

type Translate = (key: MessageKey, values?: MessageValues) => string;

export function validateGraph(graph: WorkflowGraph, mode: WorkflowMode, t: Translate): string[] {
  const errors: string[] = [];
  if (mode === 'auto') {
    for (const node of graph.nodes) {
      if (node.type === 'meeting') errors.push(t('tradewind.validation.autoMeeting', { name: node.label }));
      if (node.type === 'human-gate') errors.push(t('tradewind.validation.autoGate', { name: node.label }));
    }
  }

  const outputs = graph.nodes.filter(node => node.type === 'output');
  if (outputs.length === 0) errors.push(t('tradewind.validation.missingOutput'));
  if (outputs.length > 1) errors.push(t('tradewind.validation.multipleOutputs', { count: outputs.length }));

  for (const node of graph.nodes) {
    if (node.type === 'agent' && !(node.config as { agentId?: string }).agentId) {
      errors.push(t('tradewind.validation.agentMissingEntity', { name: node.label }));
    }
    if (node.type === 'meeting') {
      const config = node.config as { chairAgentId?: string; participantNodeIds?: string[] };
      if (!config.chairAgentId) errors.push(t('tradewind.validation.meetingMissingChair', { name: node.label }));
      if (!config.participantNodeIds?.length) errors.push(t('tradewind.validation.meetingMissingParticipants', { name: node.label }));
    }
  }

  if (!graph.nodes.some(node => node.type === 'entry')) errors.push(t('tradewind.validation.missingEntry'));
  return errors;
}
