import type { RoomMsg } from './room-messages';

export type ExpectedRoomMessage = Pick<RoomMsg, 'id' | 'timestamp' | 'speaker' | 'content'>;

/** Keep only the immutable snapshot needed by the room mutation guard. */
export function snapshotRoomMessage(message: RoomMsg): ExpectedRoomMessage {
  return {
    ...(message.id === undefined ? {} : { id: message.id }),
    timestamp: message.timestamp, speaker: message.speaker, content: message.content,
  };
}

export function findRoomMessageIndex(
  messages: RoomMsg[], expected: ExpectedRoomMessage,
): number {
  const matches: number[] = [];
  messages.forEach((message, index) => {
    if (message.id === expected.id && message.timestamp === expected.timestamp
      && message.speaker === expected.speaker && message.content === expected.content) {
      matches.push(index);
    }
  });
  return matches.length === 1 ? matches[0] : -1;
}
