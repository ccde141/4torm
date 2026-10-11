import { frameworkError } from '../../../engine/shared/framework-error.js';
import type { CycloneSeatChatPort } from './seat-chat.js';
import type { CycloneChairChatPort } from './chair-chat.js';
import type { CycloneSeatService } from './seat-service.js';
import type { CycloneExecutionSnapshot } from '../domain/operation-snapshot.js';
import type { CyclonePrivateChatActivity } from './private-chat-activity.js';

type BackgroundFailureReporter = (error: unknown) => void;

/** Agent commands use the same execution ports as human streams, but have a narrower input contract. */
export class CycloneAgentExecutionService {
  constructor(
    private readonly seatChats: CycloneSeatChatPort,
    private readonly chairChats: CycloneChairChatPort,
    private readonly seats: Pick<CycloneSeatService, 'require'>,
    private readonly reportFailure: BackgroundFailureReporter = defaultFailureReporter,
    private readonly activity?: CyclonePrivateChatActivity,
  ) {}

  async startSeat(workshopId: string, seatId: string, text: string): Promise<CycloneExecutionSnapshot> {
    const seat = await this.seats.require(workshopId, seatId);
    if (seat.pending) throw frameworkError({
      code: 'CYCLONE_SEAT_NEEDS_HUMAN', kind: 'conflict',
      message: '工位正在等待人类回答，当前不能启动新的私聊',
      source: 'cyclone.agent-execution', retryable: false,
    });
    const prepared = await this.seatChats.prepare({ workshopId, seatId, mode: 'chat', text });
    this.launch(prepared.run, this.activity?.begin(prepared.execution, text));
    return prepared.execution;
  }

  async startChair(workshopId: string, roomId: string, message: string): Promise<CycloneExecutionSnapshot> {
    const prepared = await this.chairChats.prepare({ workshopId, roomId, message });
    this.launch(prepared.run, this.activity?.begin(prepared.execution, message));
    return prepared.execution;
  }

  private launch(run: (onEvent?: (event: unknown) => void) => Promise<void>,
    activity?: { emit(event: Record<string, unknown>): void; finish(): void }): void {
    const onEvent = (event: unknown) => {
      if (event && typeof event === 'object' && !Array.isArray(event)) {
        activity?.emit(event as Record<string, unknown>);
      }
    };
    try {
      void run(onEvent).catch(error => this.reportFailure(error))
        .finally(() => activity?.finish());
    } catch (error) { activity?.finish(); this.reportFailure(error); }
  }
}

function defaultFailureReporter(error: unknown): void {
  console.error('[cyclone] Agent 启动的私聊执行失败', error);
}
