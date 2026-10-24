import { useId, useState, type ReactNode } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useProcessFade } from './useProcessFade';
import './turn-process.css';

/** Layout only: existing reasoning and tool cards keep their own presentation. */
export default function TurnProcess({ children, present, stopped, kind, followLatest = false }: {
  followLatest?: boolean;
  children: ReactNode; present: boolean; stopped?: boolean; kind: 'reasoning' | 'tools';
}) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const { viewport, content } = useProcessFade(present && open, expanded, followLatest);
  const { locale } = useLocale();
  const en = locale === 'en-US';
  if (!present) return null;
  return <section className="turn-process">
    <div className="turn-process-toolbar">
      <button type="button" className="turn-process-disclosure" onClick={() => setOpen(value => !value)}
        aria-expanded={open} aria-controls={id}>
        <span className="turn-process-arrow" aria-hidden="true">▶</span>
        <span>{kind === 'reasoning' ? (en ? 'Reasoning' : '思考过程') : (en ? 'Tool activity' : '工具过程')}</span>
        {stopped && <span>{en ? 'Stopped · received records retained' : '已停止 · 已保留接收记录'}</span>}
      </button>
      {open && <button type="button" className="turn-process-height" onClick={() => setExpanded(value => !value)}
        aria-pressed={expanded} aria-controls={id}>
        {expanded ? (en ? 'Limit height' : '限高预览') : (en ? 'Full height' : '完整高度')}
      </button>}
    </div>
    <div id={id} ref={viewport} hidden={!open} className={`turn-process-body${expanded ? ' is-expanded' : ''}`} tabIndex={0}
      role="region" aria-label={kind === 'reasoning' ? (en ? 'Reasoning' : '思考过程') : (en ? 'Tool activity' : '工具过程')}>
      <div ref={content} className="turn-process-content">{children}</div>
    </div>
  </section>;
}
