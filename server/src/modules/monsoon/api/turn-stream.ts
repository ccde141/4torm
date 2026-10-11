import { withAgentActivity } from '../../../engine/shared/agent-activity.js';
import { frameworkSseErrorFromUnknown } from '../../../engine/shared/framework-error-transport.js';
import type { MonsoonEvent, MonsoonTurn } from '../runtime/turn-contract.js';
import { BoundedSseWriter, type SseResponse } from './bounded-sse.js';

export interface MonsoonStreamResponse extends SseResponse {
  removeListener(event: 'close' | 'drain', listener: () => void): unknown;
}

export interface MonsoonStreamRuntime {
  markRunning(sessionId: string, runner: MonsoonTurn, runId: string): void | Promise<void>;
  complete(sessionId: string, runner: MonsoonTurn, runId: string,
    status: 'completed' | 'aborted' | 'waiting'): void | Promise<void>;
  fail(sessionId: string, runner: MonsoonTurn, runId: string,
    failure?: { code?: string; message?: string }): void | Promise<void>;
}

export interface MonsoonStreamOptions {
  response: MonsoonStreamResponse;
  runner: MonsoonTurn;
  runtime: MonsoonStreamRuntime;
  sessionId: string;
  runId: string;
  agentId: string;
  errorSource: string;
  execute: (emit: (event: MonsoonEvent) => void) => Promise<unknown>;
  record?: (event: MonsoonEvent) => Promise<void>;
  replyAcceptance?: Extract<MonsoonEvent, { type: 'reply-accepted' }>;
  open?: () => void;
}

/** Owns the reserved turn from response setup through its final runtime release. */
export async function runMonsoonTurnStream(options: MonsoonStreamOptions): Promise<void> {
  const { response, runner, runtime, sessionId, runId, agentId, execute } = options;
  const onDisconnect = () => { if (!response.writableEnded) runner.abort(); };
  response.once('close', onDisconnect);
  let writer: BoundedSseWriter | undefined;
  let answered = false;
  let deliveries = Promise.resolve();
  try {
    options.open?.();
    writer = new BoundedSseWriter(response, 1024 * 1024, () => runner.abort());
    writer.comment('connected');
    await runtime.markRunning(sessionId, runner, runId);
    if (options.replyAcceptance) {
      if (!options.record) throw new Error('回复确认事件缺少持久化日志');
      await options.record(options.replyAcceptance);
      writer.send(options.replyAcceptance);
    }
    await withAgentActivity(agentId, 'conversation', () => execute(event => {
      if (event.type === 'answer') answered = true;
      deliveries = deliveries.then(async () => {
        await options.record?.(event);
        writer!.send(event);
      });
      void deliveries.catch(() => runner.abort());
    }));
    await deliveries;
    const status = runner.isSuspended() ? 'waiting' : answered ? 'completed' : 'aborted';
    await runtime.complete(sessionId, runner, runId, status);
    writer.finish();
  } catch (caught) {
    let error = caught;
    try { await deliveries; } catch (deliveryError) { error = deliveryError; }
    await finishFailedTurn(options, writer, error);
  } finally {
    response.removeListener('close', onDisconnect);
  }
}

async function finishFailedTurn(
  options: MonsoonStreamOptions, writer: BoundedSseWriter | undefined, error: unknown,
): Promise<void> {
  const { response, runtime, sessionId, runId, runner, errorSource } = options;
  const failure = frameworkSseErrorFromUnknown(error, errorSource);
  let canReport = Boolean(writer);
  try { if (writer) await options.record?.(failure); }
  catch (recordError) {
    canReport = false;
    console.error('[monsoon] 无法记录失败事件', recordError);
  }
  try { await runtime.fail(sessionId, runner, runId, failure); }
  catch (persistenceError) {
    response.destroy();
    console.error('[monsoon] 无法记录失败终态', persistenceError);
    return;
  }
  if (!writer || !canReport) { response.destroy(); return; }
  try { writer.send(failure); writer.finish(); }
  catch (writeError) {
    response.destroy();
    console.error('[monsoon] 无法发送失败事件', writeError);
  }
}
