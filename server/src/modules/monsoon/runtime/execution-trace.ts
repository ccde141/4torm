import type { MonsoonEvent, MonsoonTurn } from './turn-contract.js';

export interface MonsoonExecutionPosition {
  runId: string;
  toolOffset: number;
  textOffset: number;
  reasoningOffset: number;
  eventOffset: number;
}

/** Display positions follow emitted main-level operations, independent of model context rebases. */
export class MonsoonExecutionTrace {
  private current?: MonsoonExecutionPosition;

  position(): MonsoonExecutionPosition | undefined {
    return this.current ? { ...this.current } : undefined;
  }

  wrap(turn: MonsoonTurn): MonsoonTurn {
    return {
      getCurrentInput: () => turn.getCurrentInput?.(),
      isBusy: () => turn.isBusy(), isSuspended: () => turn.isSuspended(),
      getAgentId: () => turn.getAgentId(), getInputRuntime: () => turn.getInputRuntime(),
      abort: () => turn.abort(),
      chat: (prompt, messages, emit, runId) => this.execute(runId, emit,
        observed => turn.chat(prompt, messages, observed, runId)),
      resume: (answer, emit, runId) => this.execute(runId, emit,
        observed => turn.resume(answer, observed, runId)),
    };
  }

  private async execute<T>(runId: string | undefined, emit: (event: MonsoonEvent) => void,
    work: (observed: (event: MonsoonEvent) => void) => Promise<T>): Promise<T> {
    // A concurrent rejected call must not replace the active execution's position.
    if (this.current) throw new Error('会话正在执行中');
    const position = runId ? { runId, toolOffset: 0, textOffset: 0, reasoningOffset: 0, eventOffset: 0 } : undefined;
    this.current = position;
    try {
      return await work(event => {
        if (position && (event.type === 'tool-call' || event.type === 'delegate-start')) position.toolOffset++;
        if (position && event.type === 'token') position.textOffset += event.content.length;
        if (position && event.type === 'reasoning') position.reasoningOffset += event.content.length;
        if (position) position.eventOffset++;
        emit(event);
      });
    } finally { if (this.current === position) this.current = undefined; }
  }
}
