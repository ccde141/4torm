interface SeatLite {
  id: string;
  title: string;
}

export default function RoomConfigBar({ participantIds, seats, streaming, onMove, onJoin, onLeave }: {
  participantIds: string[];
  seats: SeatLite[];
  streaming: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onJoin: (seatId: string) => void;
  onLeave: (seatId: string) => void;
}) {
  const inRoom = new Set(participantIds);
  const candidates = seats.filter(seat => !inRoom.has(seat.id));
  const seatName = (id: string) => seats.find(seat => seat.id === id)?.title || id;

  return (
    <div className="conv__config">
      <span className="conv__config-label">在场:</span>
      {participantIds.length === 0 && <span className="cyclone-room__empty-seats">（空，从右侧添加工位）</span>}
      {participantIds.map((id, index) => (
        <span key={id} className="conv__tag">
          <button onClick={() => onMove(index, -1)} disabled={streaming || index === 0} className="conv__tag-move">↑</button>
          <button onClick={() => onMove(index, 1)} disabled={streaming || index === participantIds.length - 1} className="conv__tag-move">↓</button>
          {seatName(id)}
          <button onClick={() => onLeave(id)} disabled={streaming} className="conv__tag-remove">×</button>
        </span>
      ))}
      {candidates.length > 0 && (
        <select value="" disabled={streaming} onChange={event => { if (event.target.value) onJoin(event.target.value); }} className="conv__config-select">
          <option value="">+</option>
          {candidates.map(seat => <option key={seat.id} value={seat.id}>{seat.title}</option>)}
        </select>
      )}
    </div>
  );
}
