import { readCycloneSSE } from './cyclone-sse';
import { readRoomError } from './room-messages';

export type JoinBehavior = 'summary' | 'intro' | 'none';

export interface RoomInviteResult {
  joined: true;
  introError?: string;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function inviteSeatToRoom(
  fetcher: Fetcher,
  roomUrl: string,
  seatId: string,
  behavior: JoinBehavior,
): Promise<RoomInviteResult> {
  const joinResponse = await fetcher(`${roomUrl}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatId }),
  });
  if (!joinResponse.ok) throw new Error(await readRoomError(joinResponse, '邀请工位失败'));
  if (behavior === 'none') return { joined: true };

  const introResponse = await fetcher(`${roomUrl}/intro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intros: [{ seatId, behavior }] }),
  });
  if (!introResponse.ok) {
    return { joined: true, introError: await readRoomError(introResponse, '入会发言失败') };
  }

  let introError: string | undefined;
  try {
    await readCycloneSSE(introResponse, event => {
      if (event.type === 'error') introError = String(event.message || '入会发言失败');
    });
  } catch (error) {
    introError = (error as Error).message;
  }
  return introError ? { joined: true, introError } : { joined: true };
}
