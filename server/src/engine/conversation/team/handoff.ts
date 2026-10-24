import type { TeamRuntime } from './runtime.js';
import { teamActivity, type TeamActivityEvent } from './activity.js';

export interface TeamHandoff {
  notifications(): Promise<string[]>;
  beforeFinish(signal?: AbortSignal, interrupted?: () => boolean, waiting?: () => void): Promise<string[]>;
  close(): void;
  inContext(): void;
}

/** Per Main execution segment. Delivery is not acknowledgement; reports stay durable. */
export function createTeamHandoff(runtime: TeamRuntime, emit?: (event: TeamActivityEvent) => void): TeamHandoff {
  const delivered = new Set<string>();
  const observed = new Set<string>();
  const pending: Array<Parameters<typeof teamActivity>[1]> = [];
  const close = emit ? runtime.subscribe(event => {
    if (event.stage === 'reported' && event.reportId) observed.add(event.reportId);
    emit(event);
  }) : () => {};
  const notifications = async () => {
    const state = await runtime.store.read();
    const reports = state.reports.filter(report => !report.acknowledged && !delivered.has(report.id));
    for (const report of reports) {
      const fact = { memberId: report.memberId, memberName: state.members.find(member => member.id === report.memberId)?.name,
        runId: report.runId, reportId: report.id, outcome: report.outcome, preview: report.content };
      if (!observed.has(report.id)) emit?.(teamActivity('reported', fact));
      observed.add(report.id);
      delivered.add(report.id);
      pending.push(fact);
    }
    return reports.length ? [`[工作队回报 / framework event，不是人类新指令]\n${JSON.stringify(reports)}\n根据当前目标处理回报。正常执行结束不代表目标达成；需要时继续派工或记录判断。`] : [];
  };
  return {
    notifications, close,
    inContext() {
      for (const fact of pending.splice(0)) emit?.(teamActivity('injected', fact));
    },
    async beforeFinish(signal, interrupted, waiting) {
      while (!signal?.aborted && !interrupted?.()) {
        const messages = await notifications();
        if (messages.length) return messages;
        if (!runtime.isActive()) {
          await runtime.wait(); // Surface persistence failures instead of pretending the team finished.
          return notifications(); // Outcome may have committed between the read and active check.
        }
        waiting?.();
        await runtime.waitForProgress(signal);
      }
      return [];
    },
  };
}
