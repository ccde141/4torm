import ExecutionStatusBar from '../../../components/chat/ExecutionStatusBar';
import type { CycloneDispatch } from './dispatch-timeline';
import { formatSeatDispatchActivity, formatSeatDispatchOrigin } from './seat-dispatch-activity';

export default function SeatDispatchActivity({ item }: { item: CycloneDispatch }) {
  const activity = formatSeatDispatchActivity(item);
  return (
    <>
      <div className="chat__message chat__message--user">
        <div className="chat__bubble">
          <div className="md-bubble" style={{ whiteSpace: 'pre-wrap' }}>
            <strong>{formatSeatDispatchOrigin(item)}「{item.sourceSeatTitle}」的异步任务</strong>
            {'\n\n'}{item.task}
          </div>
        </div>
      </div>
      <ExecutionStatusBar label={activity.label} target={activity.target} />
    </>
  );
}
