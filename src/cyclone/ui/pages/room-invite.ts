import { readCycloneSSE } from './cyclone-sse';
import { readRoomError } from './room-messages';

export type JoinBehavior = 'summary' | 'intro' | 'none';

export interface RoomInviteResult {
  joined: true;
  introError?: string;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RoomInviteMessages {
  joinFailed: string;
  introFailed: string;
  missingStream: string;
  disconnected: string;
}

const defaultMessages: RoomInviteMessages = {
  joinFailed: '邀请工位失败',
  introFailed: '入会发言失败',
  missingStream: 'SSE 响应缺少数据流',
  disconnected: 'SSE 连接意外中断（未收到 done/error）',
};

export async function inviteSeatToRoom(
  fetcher: Fetcher,
  roomUrl: string,
  seatId: string,
  behavior: JoinBehavior,
  messages: RoomInviteMessages = defaultMessages,
): Promise<RoomInviteResult> {
  const joinResponse = await fetcher(`${roomUrl}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatId }),
  });
  if (!joinResponse.ok) throw new Error(await readRoomError(joinResponse, messages.joinFailed));
  if (behavior === 'none') return { joined: true };

  const introResponse = await fetcher(`${roomUrl}/intro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intros: [{ seatId, behavior }] }),
  });
  if (!introResponse.ok) {
    return { joined: true, introError: await readRoomError(introResponse, messages.introFailed) };
  }

  let introError: string | undefined;
  try {
    await readCycloneSSE(introResponse, event => {
      if (event.type === 'error') introError = String(event.message || messages.introFailed);
    }, undefined, { missingBody: messages.missingStream, disconnected: messages.disconnected });
  } catch (error) {
    introError = (error as Error).message;
  }
  return introError ? { joined: true, introError } : { joined: true };
}
