import { useEffect, useState } from 'react';
import { AgentChatWindow } from '../chat/AgentChatWindow';
import { MeetingPanel } from '../meeting/MeetingPanel';
import { HumanGatePanel } from '../chat/HumanGatePanel';
import { ArchivedConversationPanel } from './records/ArchivedConversationPanel';

type Target = { nodeId: string; label: string; kind: 'agent' | 'meeting' | 'gate'; envelopeContent?: string };

/** One mounted panel set per workflow/run; switching identity cannot reuse another run's chat. */
export function WorkflowPanels({ workflowId, executionId, sealed }: {
  workflowId: string; executionId: string | null; sealed: boolean;
}) {
  const [opened, setOpened] = useState<Target[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  useEffect(() => {
    const register = (kind: Target['kind']) => (event: Event) => {
      const detail = (event as CustomEvent<Omit<Target, 'kind'> & { workflowId?: string; executionId?: string }>).detail;
      if (!executionId || !detail || typeof detail.nodeId !== 'string') return;
      if (detail.workflowId && detail.workflowId !== workflowId
        || detail.executionId && detail.executionId !== executionId) return;
      const next = { ...detail, kind };
      setOpened(previous => previous.some(item => item.nodeId === next.nodeId && item.kind === kind)
        ? previous : [...previous, next]);
      setTarget(next);
    };
    const bindings = [['tw-open-chat', register('agent')], ['tw-open-meeting', register('meeting')],
      ['tw-open-gate', register('gate')]] as const;
    for (const [name, handler] of bindings) window.addEventListener(name, handler);
    return () => { for (const [name, handler] of bindings) window.removeEventListener(name, handler); };
  }, [workflowId, executionId]);
  if (!executionId) return null;
  const archived = sealed && target && target.kind !== 'gate' ? target : null;
  return <>{archived && <ArchivedConversationPanel key={`${executionId}:${archived.kind}:${archived.nodeId}`}
    workflowId={workflowId} executionId={executionId} nodeId={archived.nodeId} label={archived.label}
    kind={archived.kind as 'agent' | 'meeting'} onClose={() => setTarget(null)} />}
    {!sealed && opened.map(item => item.kind === 'agent' ? <AgentChatWindow key={item.nodeId}
    nodeId={item.nodeId} nodeLabel={item.label} workflowId={workflowId} executionId={executionId}
    visible={target?.kind === 'agent' && target.nodeId === item.nodeId} sealed={sealed} onClose={() => setTarget(null)} />
    : item.kind === 'meeting' ? <MeetingPanel key={item.nodeId} nodeId={item.nodeId} nodeLabel={item.label}
      workflowId={workflowId} executionId={executionId} visible={target?.kind === 'meeting' && target.nodeId === item.nodeId}
      onClose={() => setTarget(null)} /> : null)}
    {target?.kind === 'gate' && !sealed && <HumanGatePanel executionId={executionId} nodeId={target.nodeId}
      nodeLabel={target.label} envelopeContent={target.envelopeContent ?? ''} onClose={() => setTarget(null)} />}
  </>;
}
