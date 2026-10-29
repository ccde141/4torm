import BoundedText from '../../../engine/text-display/BoundedText';
import { renderTextWithCode } from '../../../engine/markdown';
import { useLocale } from '../../../i18n/LocaleContext';
import { CompactedHistory } from '../CompactedHistory';
import { splitMeetingCompactions } from './meeting-compaction';
import type { MeetingChairMessage } from './meeting-client';

export default function MeetingChairMessageItem({ message, index, busy }: {
  message: MeetingChairMessage; index: number; busy: boolean;
}) {
  const { t } = useLocale();
  const parts = splitMeetingCompactions(message);
  return <>{parts.map((part, position) => <div key={part.boundary?.id ?? position} style={{ display: 'contents' }}>
    {part.boundary && <CompactedHistory content={part.boundary.summary} handoff />}
    {(part.message.content || part.message.reasoningContent || (!part.continued && busy)) &&
      <div className={`tw-meeting-msg tw-meeting-msg--${message.role}`}>
        {part.message.reasoningContent && <details className="tw-meeting-think" open={!part.message.content}>
          <summary className="tw-meeting-think__trigger">{t('tradewind.meeting.reasoning')}</summary>
          <div className="tw-meeting-think__body"><BoundedText text={part.message.reasoningContent} followTail={busy && !part.continued} /></div>
        </details>}
        <span className="tw-meeting-msg__content">{renderTextWithCode(part.message.content, `chair-${index}-${position}`)}</span>
      </div>}
  </div>)}</>;
}
