import { useState } from 'react';
import { formatObservationElapsed } from './taskboard-observations';
import { useVisualObservation } from './useVisualObservation';
import { useLocale } from '../../i18n/LocaleContext';

type Scope = 'conversation' | 'cyclone';

export default function VisualObservationView({ scope, ownerId, observationId, onBack }: { scope: Scope; ownerId: string; observationId: string; onBack: () => void }) {
  const [frameFailure, setFrameFailure] = useState<{ id: string; message: string } | null>(null);
  const { t } = useLocale();
  const { item, observedAt, error, control, frameUrl: frame } = useVisualObservation({ scope, ownerId, observationId });
  const displayError = error || (frameFailure?.id === observationId ? frameFailure.message : '');
  return <div style={shell}><header style={header}><button className="execution-surface-action" onClick={onBack} style={button}>{t('chat.execution.back')}</button><div style={{ minWidth: 0, flex: 1 }}><strong style={{ fontSize: 'var(--text-xs)' }}>{item?.viewerState?.control === 'human' ? t('chat.execution.humanControl') : t('chat.execution.agentControl')}</strong><div style={sub}>{item?.viewerState?.summary || item?.command}</div></div><span style={sub}>{item && formatObservationElapsed(item.startedAt, item.finishedAt ?? observedAt)}</span></header>{displayError ? <div style={errorStyle}>{displayError}</div> : <><img src={frame} style={image} onError={() => setFrameFailure({ id: observationId, message: t('chat.execution.noFrame') })} /><div style={footer}><span style={sub}>{t('chat.execution.frameVersion', { version: item?.viewerState?.revision ?? 0 })}</span>{item?.viewerState?.control === 'human' ? <button className="execution-surface-action" onClick={() => void control('agent')} style={button}>{t('chat.execution.giveAgentControl')}</button> : <button className="execution-surface-action" onClick={() => void control('human')} style={button}>{t('chat.execution.giveHumanControl')}</button>}</div></>}</div>;
}
const shell: React.CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 };
const header: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)', borderBottom: '1px solid var(--glass-border)' };
const footer: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--glass-border)' };
const button: React.CSSProperties = { appearance: 'none', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--color-text-secondary)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', cursor: 'pointer', fontSize: 'var(--text-xs)' };
const sub: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: 2 };
const image: React.CSSProperties = { width: '100%', minHeight: 0, flex: 1, objectFit: 'contain', background: 'rgba(5,15,22,.72)' };
const errorStyle: React.CSSProperties = { padding: 'var(--space-3)', color: 'var(--color-error)', fontSize: 'var(--text-sm)' };
