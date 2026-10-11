import type { ConvectionSessionData } from '../infrastructure/session-store.js';
import {
  handleChair,
  handleSpeak,
  type ConvectionStreamEvent,
} from '../execution/handlers.js';

export type ConvectionEventSink = (event: ConvectionStreamEvent) => void;

export class ConvectionRoundExecutor {
  constructor(private readonly dataDir: string) {}

  speak(
    session: ConvectionSessionData,
    message: string,
    onEvent: ConvectionEventSink,
    signal: AbortSignal,
    runId?: string,
  ): Promise<void> {
    return handleSpeak(this.dataDir, session, message, onEvent, signal, runId);
  }

  chair(
    session: ConvectionSessionData,
    message: string,
    onEvent: ConvectionEventSink,
    signal: AbortSignal,
    runId?: string,
  ): Promise<void> {
    return handleChair(this.dataDir, session, message, onEvent, signal, runId);
  }
}
