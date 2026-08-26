import type { KeyboardEventHandler, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { renderTextWithCode } from '../../../engine/markdown';
import type { MeetingChairMessage, MeetingMessage, MeetingStatus } from './meeting-client';
import { MeetingMessageItem } from './MeetingMessageItem';
import { useLocale } from '../../../i18n/LocaleContext';

export type MeetingView = 'public' | 'chair';

interface MeetingPanelViewProps {
  nodeLabel: string;
  visible: boolean;
  activeView: MeetingView;
  setActiveView: (view: MeetingView) => void;
  status: MeetingStatus | null;
  publicMsgs: MeetingMessage[];
  chairMsgs: MeetingChairMessage[];
  publicInput: string;
  chairInput: string;
  setPublicInput: (value: string) => void;
  setChairInput: (value: string) => void;
  busy: boolean;
  chairBusy: boolean;
  error: string | null;
  isOpening: boolean;
  isEnded: boolean;
  publicStateLabel: string;
  chairStateLabel: string;
  publicEndRef: RefObject<HTMLDivElement | null>;
  chairEndRef: RefObject<HTMLDivElement | null>;
  publicContainerRef: RefObject<HTMLDivElement | null>;
  chairContainerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onEndMeeting: () => void;
  onJoin: (nodeId: string) => void;
  onLeave: (nodeId: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onSendPublic: () => void;
  onSendChair: () => void;
  onAbortRound: () => void;
  onPublicKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onChairKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
}

export default function MeetingPanelView(props: MeetingPanelViewProps) {
  const { t } = useLocale();
  const {
    nodeLabel, visible, activeView, setActiveView, status, publicMsgs, chairMsgs,
    publicInput, chairInput, setPublicInput, setChairInput, busy, chairBusy, error,
    isOpening, isEnded, publicStateLabel, chairStateLabel, publicEndRef, chairEndRef,
    publicContainerRef, chairContainerRef, onClose, onEndMeeting, onJoin, onLeave,
    onMoveUp, onMoveDown, onSendPublic, onSendChair, onAbortRound,
    onPublicKeyDown, onChairKeyDown,
  } = props;

  return createPortal(
    <div className="tw-meeting-overlay" style={{ display: visible ? undefined : 'none' }}>
      <div className="tw-meeting-panel" role="dialog" aria-modal="true" aria-label={t('tradewind.meeting.dialogLabel', { name: nodeLabel })}>
        <div className="tw-meeting-panel__header">
          <div className="tw-meeting-panel__identity">
            <span className="tw-meeting-panel__eyebrow">MEETING NODE</span>
            <span className="tw-meeting-panel__title">{nodeLabel}{isEnded && t('tradewind.meeting.endedSuffix')}</span>
          </div>
          <span className={`tw-meeting-panel__header-state${busy ? ' tw-meeting-panel__header-state--active' : ''}`}>
            {publicStateLabel}
          </span>
          <div className="tw-meeting-panel__actions">
            {!isEnded && (
              <button className="tw-meeting-panel__end-btn" onClick={onEndMeeting} disabled={busy || isOpening}>{t('tradewind.meeting.end')}</button>
            )}
            <button className="tw-meeting-panel__close" onClick={onClose} aria-label={t('tradewind.meeting.close')}>×</button>
          </div>
        </div>
        {error && <div className="tw-meeting-panel__error">{error}</div>}
        {isOpening && <div className="tw-meeting-panel__opening-banner">{t('tradewind.meeting.openingBanner')}</div>}
        {isEnded && <div className="tw-meeting-panel__opening-banner">{t('tradewind.meeting.endedBanner')}</div>}
        <div className="tw-meeting-panel__body">
          <aside className="tw-meeting-panel__rail" aria-label={t('tradewind.meeting.sessions')}>
            <span className="tw-meeting-panel__rail-label">{t('tradewind.meeting.sessions')}</span>
            <button className={`tw-meeting-panel__nav-item${activeView === 'public' ? ' tw-meeting-panel__nav-item--active' : ''}`} onClick={() => setActiveView('public')} aria-pressed={activeView === 'public'}>
              <span className="tw-meeting-panel__nav-icon">#</span>
              <span className="tw-meeting-panel__nav-copy"><strong>{t('tradewind.meeting.publicTitle')}</strong><small>{publicStateLabel}</small></span>
              {busy && <span className="tw-meeting-panel__nav-pulse" />}
            </button>
            <button className={`tw-meeting-panel__nav-item${activeView === 'chair' ? ' tw-meeting-panel__nav-item--active' : ''}`} onClick={() => setActiveView('chair')} aria-pressed={activeView === 'chair'}>
              <span className="tw-meeting-panel__nav-icon">{t('tradewind.meeting.chairIcon')}</span>
              <span className="tw-meeting-panel__nav-copy"><strong>{t('tradewind.meeting.chairTitle')}</strong><small>{chairStateLabel}</small></span>
              {chairBusy && <span className="tw-meeting-panel__nav-pulse" />}
            </button>
            <div className="tw-meeting-panel__rail-spacer" />
            <span className="tw-meeting-panel__rail-foot">{t('tradewind.meeting.chairReviewHint')}</span>
          </aside>
          <div className="tw-meeting-panel__workspace">
            <section className="tw-meeting-panel__conversation tw-meeting-panel__conversation--public" hidden={activeView !== 'public'} aria-hidden={activeView !== 'public'}>
              <div className="tw-meeting-panel__conversation-head"><div><span className="tw-meeting-panel__section-title">{t('tradewind.meeting.publicTitle')}</span><small>{t('tradewind.meeting.publicSubtitle')}</small></div></div>
              {status && (
                <div className="tw-meeting-panel__participants">
                  <div className="tw-meeting-panel__participant-list">
                    {status.participants.map((participant, index) => (
                      <div key={participant.nodeId} className="tw-meeting-panel__participant">
                        <button className="tw-meeting-panel__participant-move" onClick={() => onMoveUp(index)} disabled={index === 0}>↑</button>
                        <button className="tw-meeting-panel__participant-move" onClick={() => onMoveDown(index)} disabled={index === status.participants.length - 1}>↓</button>
                        <span className="tw-meeting-panel__participant-name">{participant.label}</span>
                        <button className="tw-meeting-panel__participant-remove" onClick={() => onLeave(participant.nodeId)}>×</button>
                      </div>
                    ))}
                  </div>
                  <select className="tw-meeting-panel__participant-add" value="" onChange={(event) => { if (event.target.value) onJoin(event.target.value); }}>
                    <option value="">{t('tradewind.meeting.join')}</option>
                    {(status.configuredParticipants || []).filter(candidate => !status.participants.some(participant => participant.nodeId === candidate.nodeId)).map(candidate => (
                      <option key={candidate.nodeId} value={candidate.nodeId}>{candidate.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="tw-meeting-panel__messages" ref={publicContainerRef}>
                {publicMsgs.map((message, index) => <MeetingMessageItem key={index} msg={message} />)}
                <div ref={publicEndRef} />
              </div>
              <div className={`tw-meeting-panel__status${busy ? ' tw-meeting-panel__status--active' : ''}`}><span className="tw-meeting-panel__status-pulse" />{publicStateLabel}</div>
              <div className="tw-meeting-panel__input-area"><div className="tw-meeting-panel__composer">
                <textarea className="tw-meeting-panel__input" value={publicInput} onChange={(event) => setPublicInput(event.target.value)} onKeyDown={onPublicKeyDown} placeholder={isEnded ? t('tradewind.meeting.endedPlaceholder') : isOpening ? t('tradewind.meeting.openingPlaceholder') : t('tradewind.meeting.publicPlaceholder')} disabled={busy || isOpening || isEnded} rows={1} />
                {busy ? (
                  <button className="tw-meeting-panel__stop" onClick={onAbortRound} aria-label={t('tradewind.meeting.stopRound')}>■</button>
                ) : (
                  <button className="tw-meeting-panel__send" onClick={onSendPublic} disabled={isOpening || isEnded || !publicInput.trim()}>{t('tradewind.meeting.send')}</button>
                )}
              </div></div>
            </section>
            <section className="tw-meeting-panel__conversation tw-meeting-panel__conversation--chair" hidden={activeView !== 'chair'} aria-hidden={activeView !== 'chair'}>
              <div className="tw-meeting-panel__conversation-head"><div><span className="tw-meeting-panel__section-title">{t('tradewind.meeting.chairTitle')}</span><small>{t('tradewind.meeting.chairSubtitle')}</small></div></div>
              <div className="tw-meeting-panel__messages" ref={chairContainerRef}>
                {chairMsgs.filter(message => message.role !== 'system').map((message, index) => (
                  <div key={index} className={`tw-meeting-msg tw-meeting-msg--${message.role}`}>
                    {message.reasoningContent && <details className="tw-meeting-think" open={!message.content}><summary className="tw-meeting-think__trigger">{t('tradewind.meeting.reasoning')}</summary><div className="tw-meeting-think__body">{message.reasoningContent}</div></details>}
                    <span className="tw-meeting-msg__content">{renderTextWithCode(message.content, `chair-${index}`)}</span>
                  </div>
                ))}
                <div ref={chairEndRef} />
              </div>
              <div className={`tw-meeting-panel__status${chairBusy ? ' tw-meeting-panel__status--active' : ''}`}><span className="tw-meeting-panel__status-pulse" />{chairStateLabel}</div>
              <div className="tw-meeting-panel__input-area"><div className="tw-meeting-panel__composer">
                <textarea className="tw-meeting-panel__input" value={chairInput} onChange={(event) => setChairInput(event.target.value)} onKeyDown={onChairKeyDown} placeholder={isOpening ? t('tradewind.meeting.openingPlaceholder') : t('tradewind.meeting.chairPlaceholder')} rows={1} disabled={isOpening || chairBusy} />
                <button className="tw-meeting-panel__send" onClick={onSendChair} disabled={isOpening || chairBusy || !chairInput.trim()}>{t('tradewind.meeting.send')}</button>
              </div></div>
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
