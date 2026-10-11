import type { ConvectionRoundIdentity, ConvectionRoundStatus } from './convection-runtime';

interface RoundReconciliation<T> {
  readRound: () => Promise<ConvectionRoundStatus | null>;
  loadMessages: () => Promise<T>;
  settle: (messages: T, terminal: Exclude<NonNullable<ConvectionRoundStatus>, { status: 'running' }>) => void;
}

/** A terminal probe only releases the UI after committed messages are readable. */
export async function reconcileConvectionRound<T>({
  readRound, loadMessages, settle,
}: RoundReconciliation<T>): Promise<
  { status: 'running'; runtime: ConvectionRoundIdentity }
    | { status: 'completed' | 'aborted' | 'failed' | 'crashed' }
> {
  const runtime = await readRound();
  if (!runtime) throw new Error('中心状态缺少对流会话');
  if (runtime.status === 'running') {
    return { status: 'running', runtime: { round: runtime.round, runId: runtime.runId } };
  }
  const messages = await loadMessages();
  settle(messages, runtime);
  return { status: runtime.status };
}
