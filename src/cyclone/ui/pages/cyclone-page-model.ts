import type { SeatDraft } from './SeatPanel';

export interface WorkshopSummary {
  id: string;
  title: string;
  seatCount: number;
  roomCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SeatSummary {
  id: string;
  agentId: string;
  title: string;
  duty?: string;
  pending?: boolean;
}

export interface RoomSummary {
  id: string;
  title: string;
}

export type CycloneView =
  | { kind: 'seat'; id: string }
  | { kind: 'room'; id: string }
  | { kind: 'bulletin' }
  | { kind: 'create-room'; seatIds?: string[] }
  | { kind: 'create-workshop' }
  | { kind: 'create-seat' }
  | { kind: 'loading-seat'; id: string; error?: string }
  | { kind: 'edit-seat'; id: string; draft: SeatDraft }
  | null;

export async function readCycloneError(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => ({}));
  return payload?.error || `${fallback}（HTTP ${response.status}）`;
}
