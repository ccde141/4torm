import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Agent } from '../../types';
import type { AgentActivityView } from './dashboard-activity';
import AgentAvatar from './AgentAvatar';
import AgentCard from './AgentCard';
import AgentActivityOverview from './AgentActivityOverview';
import AgentActivityStats from './AgentActivityStats';
import AgentDetailNav from './AgentDetailNav';
import AgentConfigModal from './AgentConfigModal';
import MemoryPanel from './MemoryPanel';
import { AGENT_CONFIG_TABS, AGENT_CONFIG_TAB_LABELS, isAgentConfigTab,
  type AgentConfigTab } from './AgentConfigTabs';
import { useLocale } from '../../i18n/LocaleContext';
import { activityStatusLabel } from './agent-card-view';
import { useConfirm } from '../common/ConfirmDialog';
import '../../styles/components/agent-detail.css';

interface Rect { left: number; top: number; width: number; height: number }
interface Props {
  agent: Agent;
  activity: AgentActivityView;
  origin: Rect;
  onClose: () => void;
  onSaveConfig: () => void;
  onDelete: () => void;
  onNavigate?: (page: string, targetId?: string) => void;
}

function destination(): Rect {
  const width = Math.min(1060, window.innerWidth - 32);
  const height = Math.min(705, window.innerHeight - 32);
  return { left: (window.innerWidth - width) / 2,
    top: (window.innerHeight - height) / 2, width, height };
}

function focusWithin(dialog: HTMLElement, event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
    .filter(button => button.getClientRects().length > 0);
  if (!buttons.length) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

export default function AgentDetailDialog(props: Props) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const { agent, activity, origin, onClose, onSaveConfig, onDelete, onNavigate } = props;
  const [rect, setRect] = useState(origin);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const deletingRef = useRef(false);
  const [section, setSection] = useState<'overview' | 'stats' | AgentConfigTab | 'memory'>('overview');
  const [configVisited, setConfigVisited] = useState(false);
  const [memoryVisited, setMemoryVisited] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closingRef = useRef(false);
  const finishedRef = useRef(false);
  const sourceRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const finishClose = useCallback(() => {
    if (!closingRef.current || finishedRef.current) return;
    finishedRef.current = true;
    window.clearTimeout(closeTimer.current);
    const source = sourceRef.current;
    closeRef.current();
    requestAnimationFrame(() => { if (source?.isConnected) source.focus(); });
  }, []);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true); setOpen(false);
    const source = document.querySelector<HTMLElement>(`[data-agent-card="${CSS.escape(agent.id)}"]`);
    sourceRef.current = source;
    const bounds = source?.getBoundingClientRect();
    if (bounds) setRect(bounds);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      closeTimer.current = window.setTimeout(finishClose, 0);
    } else closeTimer.current = window.setTimeout(finishClose, 560);
  }, [agent.id, finishClose]);

  const remove = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    try {
      if (!await confirm({ title: t('agent.deleteTitle', { name: agent.name }),
        message: t('agent.deleteWarning'), confirmText: t('common.delete'), danger: true })) return;
      onDelete();
      close();
    } finally { deletingRef.current = false; }
  };

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { setRect(destination()); setOpen(true); });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      else if (dialogRef.current) focusWithin(dialogRef.current, event);
    };
    const resize = () => setRect(destination());
    window.addEventListener('keydown', keydown);
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(frame);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', resize); };
  }, [close]);

  useEffect(() => {
    if (open) dialogRef.current?.querySelector<HTMLButtonElement>('.agent-detail__close')?.focus();
  }, [open]);

  const configSection = isAgentConfigTab(section);
  const navItems = [
    { id: 'overview', label: t('dashboard.detail.overview') },
    { id: 'stats', label: t('dashboard.detail.statistics') },
    ...AGENT_CONFIG_TABS.map(id => ({ id, label: t(id === 'basic'
      ? 'dashboard.detail.configure' : AGENT_CONFIG_TAB_LABELS[id]) })),
    { id: 'memory', label: t('dashboard.detail.memory') },
  ] as const;
  const selectSection = (id: typeof section) => {
    setSection(id);
    if (isAgentConfigTab(id)) setConfigVisited(true);
    if (id === 'memory') setMemoryVisited(true);
  };
  return createPortal(<>
    <div className={`agent-detail__scrim${open && !closing ? ' agent-detail__scrim--open' : ''}`}
      onClick={close} />
    <section ref={dialogRef} className={`agent-detail${open && !closing ? ' agent-detail--open' : ''}${closing ? ' agent-detail--closing' : ''}`}
      role="dialog" aria-modal="true" aria-label={t('dashboard.card.open', { name: agent.name })}
      onTransitionEnd={event => {
        if (event.target === dialogRef.current && ['left', 'top', 'width', 'height'].includes(event.propertyName))
          finishClose();
      }}
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      <div className="agent-detail__card-preview" inert aria-hidden="true">
        <AgentCard agent={agent} activity={activity} onClick={close} />
      </div>
      <div className="agent-detail__content" inert={closing}>
        <header className="agent-detail__head">
          <AgentAvatar agent={agent} className="agent-detail__avatar" fallback={agent.name[0]} />
          <div className="agent-detail__identity"><small>{t('dashboard.agent')} / {agent.id}</small><h2>{agent.name}</h2><p>{agent.role}</p></div>
          <span className={`agent-detail__status agent-detail__status--${activity.kind}`}>
            <i aria-hidden="true" /> {activityStatusLabel(activity, t)}</span>
          <button type="button" aria-label={t('dashboard.detail.close')}
            className="agent-detail__close" onClick={close}>×</button>
        </header>
        <div className="agent-detail__body">
          <AgentDetailNav items={navItems} active={section}
            label={t('dashboard.detail.navigation')} onSelect={selectSection} />
          <div className="agent-detail__sections">
          <section className="agent-detail__section" hidden={section !== 'overview'}>
            <AgentActivityOverview agentId={agent.id} activity={activity}
              onNavigate={onNavigate ? (page, targetId) => {
              close(); onNavigate(page, targetId);
            } : undefined} />
          </section>
          <section className="agent-detail__section" hidden={section !== 'stats'}>
            <AgentActivityStats activity={activity} />
          </section>
          <section className="agent-detail__section agent-detail__section--editor" hidden={!configSection}>
            <div className="agent-detail__section-title"><h3>{navItems.find(entry => entry.id === section)?.label}</h3></div>
            {configVisited && <AgentConfigModal mode="embedded" agent={agent}
              tab={isAgentConfigTab(section) ? section : 'basic'}
              onClose={() => setSection('overview')} onSave={onSaveConfig} />}
          </section>
          <section className="agent-detail__section agent-detail__section--memory" hidden={section !== 'memory'}>
            <div className="agent-detail__section-title"><h3>{t('memory.title')}</h3></div>
            {memoryVisited && <MemoryPanel embedded agentId={agent.id} agentName={agent.name} />}
          </section>
          </div>
        </div>
        <footer className="agent-detail__foot">
          <button type="button" className="agent-detail__danger" onClick={() => void remove()}>{t('common.delete')}</button>
        </footer>
      </div>
    </section>
  </>, document.body);
}
