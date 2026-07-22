import DispatchCard from './DispatchCard';
import RoomFeedRow from './RoomFeedRow';
import { buildDispatchTimeline, type CycloneDispatch } from './dispatch-timeline';
import type { DispatchAction } from './useWorkshopDispatches';
import type { FeedMsg } from './useRoomStreamRunners';

interface TimelineEntry {
  key: string;
  turnId?: string;
  message: FeedMsg;
  index: number;
  prefix: 'h' | 'r';
}

export default function RoomTimeline({ history, roundFeed, dispatches, highlightedId,
  editingMessageIndex, editMessageContent, onEditContent, onStartEdit, onSaveEdit,
  onCancelEdit, onDelete, onDispatchAction, onOpenSeat }: {
  history: FeedMsg[]; roundFeed: FeedMsg[] | null; dispatches: CycloneDispatch[];
  highlightedId: string | null; editingMessageIndex: number | null; editMessageContent: string;
  onEditContent: (value: string) => void; onStartEdit: (message: FeedMsg) => void;
  onSaveEdit: () => void; onCancelEdit: () => void; onDelete: (message: FeedMsg) => void;
  onDispatchAction: (id: string, action: DispatchAction) => Promise<void>;
  onOpenSeat: (seatId: string) => void;
}) {
  const messages: TimelineEntry[] = [
    ...history.map((message, index) => ({ key: message.key, turnId: message.turnId, message, index, prefix: 'h' as const })),
    ...(roundFeed || []).map((message, index) => ({ key: message.key, turnId: message.turnId, message, index, prefix: 'r' as const })),
  ];
  const timeline = buildDispatchTimeline(messages, dispatches);

  return timeline.map(item => {
    if (item.kind === 'dispatch') {
      return <DispatchCard key={`dispatch-${item.dispatch.id}`} item={item.dispatch}
        highlighted={highlightedId === item.dispatch.id}
        onAction={action => onDispatchAction(item.dispatch.id, action)}
        onOpenSeat={() => onOpenSeat(item.dispatch.targetSeatId)} />;
    }
    const { message, index, prefix } = item.message;
    return <RoomFeedRow key={`${prefix}-${message.key}`} m={message} idx={index} prefix={prefix}
      editing={prefix === 'h' && editingMessageIndex === message.sourceIndex}
      editContent={editMessageContent} onEditContent={onEditContent}
      onStartEdit={() => onStartEdit(message)} onSaveEdit={onSaveEdit}
      onCancelEdit={onCancelEdit} onDelete={() => onDelete(message)} />;
  });
}
