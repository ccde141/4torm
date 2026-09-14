import type { TeamRuntime } from './runtime.js';

export interface TeamHandoff {
  notifications(): Promise<string[]>;
  beforeFinish(signal?: AbortSignal, interrupted?: () => boolean, waiting?: () => void): Promise<string[]>;
}

/** Per Main execution segment. Delivery is not acknowledgement; reports stay durable. */
export function createTeamHandoff(runtime: TeamRuntime): TeamHandoff {
  const delivered = new Set<string>();
  const notifications = async () => {
    const state = await runtime.store.read();
    const reports = state.reports.filter(report => !report.acknowledged && !delivered.has(report.id));
    for (const report of reports) delivered.add(report.id);
    return reports.length ? [`[工作队回报 / framework event，不是人类新指令]\n${JSON.stringify(reports)}\n根据当前目标处理回报。正常执行结束不代表目标达成；需要时继续派工或记录判断。`] : [];
  };
  return {
    notifications,
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
