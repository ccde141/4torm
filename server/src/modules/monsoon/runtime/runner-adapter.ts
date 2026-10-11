import { SessionRunner, type SessionRunnerOpts } from '../../../engine/conversation/session-runner.js';
import { SessionTeams } from '../../../engine/conversation/team/registry.js';
import { teamToolDefs } from '../../../engine/conversation/team/tools.js';
import { AgentCollaborationTools } from '../../../engine/conversation/agent-collaboration-tools.js';
import { buildVirtualToolDefs } from '../../../engine/conversation/virtual-tools.js';
import { buildBackgroundExecutionToolDefs } from '../../../engine/shared/background-execution-tools.js';
import { buildMemoryToolDefs } from '../../../engine/shared/agent-memory.js';
import { FRAMEWORK_TOOLS } from '../../../tools/framework/catalog.js';
import type { MonsoonTurn, MonsoonTurnSpec } from './turn-contract.js';
import { monsoonCompactionTransform } from './automatic-compaction.js';

/** The only Monsoon dependency on the former shared runner. */
export class MonsoonRunnerAdapter {
  private readonly teams = new SessionTeams();
  private readonly options = new WeakMap<MonsoonTurn, SessionRunnerOpts>();

  constructor(
    private readonly loadCollaboration: typeof AgentCollaborationTools.load
      = AgentCollaborationTools.load,
  ) {}

  create(spec: MonsoonTurnSpec): MonsoonTurn {
    const options = runnerOptions(spec);
    const runner = new SessionRunner(options);
    this.options.set(runner, options);
    return runner;
  }

  async ready(turn: MonsoonTurn): Promise<void> {
    const options = this.options.get(turn);
    if (!options) throw new Error('MONSOON_TURN_UNKNOWN');
    const team = await this.teams.extension(options);
    const collaboration = await this.loadCollaboration({
      agentId: options.agentId, sessionId: options.sessionId,
    }, reservedNames());
    options.extension = {
      definitions: [...team.definitions, ...collaboration.runtimeDefinitions],
      guideDefinitions: [...team.definitions, ...collaboration.definitions],
      createHandoff: team.createHandoff,
      call: (name, args, signal) => collaboration.handles(name)
        ? collaboration.call(name, args, signal)
        : team.call(name, args, signal),
    };
  }

  stopTeam(sessionId: string): boolean { return this.teams.stop(sessionId); }
  shutdown(): Promise<void> { return this.teams.shutdown(); }
}

function reservedNames(): string[] {
  return [
    ...FRAMEWORK_TOOLS,
    ...buildVirtualToolDefs(true, {
      allowDelegate: false, allowFrameworkStatus: true,
    }),
    ...buildBackgroundExecutionToolDefs(),
    ...buildMemoryToolDefs(),
    ...teamToolDefs(),
  ].map(definition => definition.name);
}

function runnerOptions(spec: MonsoonTurnSpec): SessionRunnerOpts {
  return { ...spec, mainAgent: true, allowDelegate: false,
    llmTransform: monsoonCompactionTransform(spec) };
}
