import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../../../i18n/LocaleContext';
import { readWorkflowRun } from './records-client';
import { useRecordQuery } from './useRecordQuery';
import { ArchiveBody } from './ArchiveBody';
import './records.css';

/** Finished runs use their archive; live-node endpoints cannot restore an old execution. */
export function ArchivedConversationPanel({ workflowId, executionId, nodeId, label, kind, onClose }: {
  workflowId: string; executionId: string; nodeId: string; label: string;
  kind: 'agent' | 'meeting'; onClose: () => void;
}) {
  const { locale, t } = useLocale();
  const english = locale === 'en-US';
  const [round, setRound] = useState<number>();
  const [revision, setRevision] = useState(0);
  const load = useCallback(() => readWorkflowRun(workflowId, executionId), [workflowId, executionId]);
  const query = useRecordQuery(`${workflowId}:${executionId}`, load, revision);
  const archives = query.data?.archives?.filter(item => item.nodeId === nodeId
    && item.kind === (kind === 'agent' ? 'node-context' : 'meeting')) ?? [];
  const archive = archives.find(item => item.round === round) ?? archives.at(-1);
  return createPortal(<div className="tw-chat-overlay" role="dialog" aria-modal="true" aria-label={label}>
    <div className="tw-chat-window">
      <div className="tw-chat-window__header"><div className="tw-chat-window__identity">
        <span className="tw-chat-window__eyebrow">{kind === 'agent' ? 'AGENT NODE' : 'MEETING'}</span>
        <span className="tw-chat-window__title">{label}</span>
      </div><span className="tw-chat-window__state">{t('tradewind.chat.sealedBadge')}</span>
        <button className="tw-chat-window__close" onClick={onClose} aria-label={t('tradewind.chat.close')}>×</button>
      </div>
      <div className="tw-chat-window__messages tw-records">
        <div className="tw-records-heading"><code>{executionId}</code>
          <button type="button" onClick={() => setRevision(value => value + 1)}>{english ? 'Refresh' : '刷新'}</button></div>
        {query.loading && !query.data && <p role="status">{english ? 'Loading records…' : '正在读取记录…'}</p>}
        {query.error && <p className="tw-record-error" role="alert">{query.error}</p>}
        {archives.length > 1 && <nav className="tw-record-archive-list" aria-label={english ? 'Meeting rounds' : '会议轮次'}>
          {archives.map(item => <button key={item.round} type="button" aria-pressed={item === archive}
            onClick={() => setRound(item.round)}>{english ? 'Round' : '轮次'} {item.round}</button>)}
        </nav>}
        {archive?.state === 'available' && <ArchiveBody key={`${archive.round ?? ''}:${revision}`}
          workflowId={workflowId} executionId={executionId} archive={archive} english={english} refreshKey={String(revision)} />}
        {query.data && archive?.state !== 'available' && <p className="tw-record-empty">
          {english ? 'This execution did not save this node record.' : '本次执行没有保存这个节点的记录。'}</p>}
      </div>
      <div className="tw-chat-window__input-area"><div className="tw-chat-window__sealed">{t('tradewind.chat.sealedMessage')}</div></div>
    </div>
  </div>, document.body);
}
