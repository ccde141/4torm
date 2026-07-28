import type { RoomMsg } from './room-messages';

interface SeatLite {
  id: string;
  title: string;
}

export function roomSeatName(
  seatId: string,
  seats: SeatLite[],
  messages: RoomMsg[],
): string {
  const currentTitle = seats.find(seat => seat.id === seatId)?.title;
  if (currentTitle) return currentTitle;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.seatId !== seatId) continue;
    if (message.kind === 'membership') {
      const suffix = message.membershipAction === 'left' ? '离开会议' : '加入会议';
      if (message.content.endsWith(suffix)) return message.content.slice(0, -suffix.length);
    }
    if (message.speaker && message.speaker !== '系统' && message.speaker !== seatId) {
      return message.speaker;
    }
  }
  return '已删除工位';
}
