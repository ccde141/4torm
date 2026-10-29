import type { SessionRunnerOpts } from '../session-runner.js';
import { loadAgentToolDefs } from '../../shared/tool-defs-loader.js';
import { TeamStore } from './store.js';
import { TeamRuntime } from './runtime.js';
import { memberExecutor } from './executor.js';
import { teamExtension } from './tools.js';
import type { ReportDeliveryEvidence } from './report-delivery.js';

export class SessionTeams {
  private readonly teams = new Map<string, TeamRuntime>();
  async extension(opts: SessionRunnerOpts, readDeliveryEvidence?: () => Promise<ReportDeliveryEvidence[]>) {
    const key = `${opts.agentId}/${opts.sessionId}`;
    let runtime = this.teams.get(key);
    if (!runtime) {
      runtime = new TeamRuntime(new TeamStore(opts.dataDir, { agentId: opts.agentId, sessionId: opts.sessionId! }), memberExecutor(opts));
      this.teams.set(key, runtime);
    }
    runtime.configure(memberExecutor(opts));
    await runtime.store.recoverInterrupted();
    const tools = await loadAgentToolDefs(opts.dataDir, opts.toolNames, opts.skillIds, opts.toolMode);
    return teamExtension(runtime, { tools: tools.map(tool => tool.name), skills: opts.skillIds,
      sandboxLevel: opts.sandboxLevel === 'unrestricted' ? 'unrestricted' : 'project' }, readDeliveryEvidence);
  }
  stop(sessionId: string): boolean {
    let stopped = false;
    for (const [key, runtime] of this.teams) if (key.endsWith(`/${sessionId}`)) {
      stopped ||= runtime.isActive();
      runtime.stop();
    }
    return stopped;
  }
  async shutdown(): Promise<void> {
    for (const runtime of this.teams.values()) runtime.stop();
    await Promise.all([...this.teams.values()].map(runtime => runtime.wait()));
    this.teams.clear();
  }
}
