import type { ConvectionRoundIdentity, ConvectionRoundStatus } from './convection-runtime';
import { compactionActivity } from '../../../components/common/compaction-activity';

interface RoundReconciliation<T> {
  readRound: () => Promise<ConvectionRoundStatus | null>;
  loadMessages: () => Promise<T>;
  settle: (messages: T, terminal: Exclude<NonNullable<ConvectionRoundStatus>, { status: 'running' }>) => void;
}

/** Inline context commands have no runId. Verify only their saved scope with bounded reads. */
export async function reconcileConvectionCompaction<T extends {
  compactionProgress?: unknown; chairCompactionProgress?: unknown;
}>(input: { scope: 'public' | 'chair'; readContext: () => Promise<T | undefined>;
  signal?: AbortSignal; waitForRetry?: (ms: number) => Promise<void> }): Promise<
  { status: 'settled' | 'running'; context: T } | { status: 'unconfirmed' }
> {
  let latest: T | undefined;
  for (const delay of [500, 1_500, 3_000]) {
    await (input.waitForRetry?.(delay) ?? wait(delay, input.signal));
    input.signal?.throwIfAborted();
    try { latest = await input.readContext(); }
    catch { latest = undefined; }
    input.signal?.throwIfAborted();
    if (!latest) continue;
    const progress = compactionActivity(input.scope === 'public'
      ? latest.compactionProgress : latest.chairCompactionProgress);
    if (progress?.phase !== 'running') return { status: 'settled', context: latest };
  }
  return latest ? { status: 'running', context: latest } : { status: 'unconfirmed' };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
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
