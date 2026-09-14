import { useState, type ReactNode } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useProcessFade } from './useProcessFade';
import './turn-process.css';

/** Layout only: existing reasoning and tool cards keep their own presentation. */
export default function TurnProcess({ children, present, stopped, kind, followLatest = false }: {
  followLatest?: boolean;
  children: ReactNode; present: boolean; stopped?: boolean; kind: 'reasoning' | 'tools';
}) {
  const [expanded, setExpanded] = useState(false);
  const { viewport, content } = useProcessFade(present, expanded, followLatest);
  const { locale } = useLocale();
  const en = locale === 'en-US';
  if (!present) return null;
  return <section className="turn-process">
    <div className="turn-process-toolbar">
      <span>{kind === 'reasoning' ? (en ? 'Reasoning' : '思考过程') : (en ? 'Tool activity' : '工具过程')}</span>
      {stopped && <span>{en ? 'Stopped · received records retained' : '已停止 · 已保留接收记录'}</span>}
      <button onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        {expanded ? (en ? 'Limit height' : '收起高度') : (en ? 'Expand all' : '展开全部')}
      </button>
    </div>
    <div ref={viewport} className={`turn-process-body${expanded ? ' is-expanded' : ''}`} tabIndex={0}
      role="region" aria-label={kind === 'reasoning' ? (en ? 'Reasoning' : '思考过程') : (en ? 'Tool activity' : '工具过程')}>
      <div ref={content} className="turn-process-content">{children}</div>
    </div>
  </section>;
}
