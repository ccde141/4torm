import ExecutionStatusBar from '../../../components/chat/ExecutionStatusBar';
import { useLocale } from '../../../i18n/LocaleContext';
import type { CycloneDispatch } from './dispatch-timeline';
import { formatSeatDispatchActivity, formatSeatDispatchOrigin } from './seat-dispatch-activity';

export default function SeatDispatchActivity({ item }: { item: CycloneDispatch }) {
  const { t } = useLocale();
  const activity = formatSeatDispatchActivity(item, t);
  const origin = formatSeatDispatchOrigin(item, t);
  return (
    <>
      <div className="chat__message chat__message--user">
        <div className="chat__bubble">
          <div className="md-bubble" style={{ whiteSpace: 'pre-wrap' }}>
            <strong>{t('cyclone.dispatch.incomingTask', { origin, seat: item.sourceSeatTitle })}</strong>
            {'\n\n'}{item.task}
          </div>
        </div>
      </div>
      <ExecutionStatusBar label={activity.label} target={activity.target} />
    </>
  );
}
