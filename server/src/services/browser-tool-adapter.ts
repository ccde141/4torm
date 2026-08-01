import { type BrowserRuntimeInput, browserRuntime } from './browser-runtime.js';
import { normalizeBrowserEngine } from './browser-engine.js';
import { loadAgent } from '../engine/shared/agent-loader.js';
import type { ObservationScope } from './execution-observation-contract.js';

type ObservationContext = { scope: ObservationScope; ownerId: string };
type BrowserRuntimeExecutor = { execute(input: BrowserRuntimeInput): Promise<string> };
type AgentSkillsLoader = (dataDir: string, agentId: string) => Promise<{ skills: string[] } | null>;

interface BrowserToolInput {
  dataDir: string;
  agentId: string;
  args: Record<string, string>;
  observation?: ObservationContext;
  signal?: AbortSignal;
}

interface BrowserToolDeps {
  loadAgent?: AgentSkillsLoader;
  runtime?: BrowserRuntimeExecutor;
}

export async function executeBrowserTool(input: BrowserToolInput, deps: BrowserToolDeps = {}): Promise<string> {
  if (!input.observation) throw new Error('browser requires an owning conversation or cyclone context');
  const agent = await (deps.loadAgent ?? loadAgent)(input.dataDir, input.agentId);
  if (!agent?.skills.includes('browser')) throw new Error('Browser Skill is not enabled for this agent');
  const engine = normalizeBrowserEngine(input.args.engine || undefined);
  if (!engine) throw new Error('unsupported browser engine');
  const action: BrowserRuntimeInput = {
    ...input.observation,
    action: input.args.action || '',
    engine,
    ...(input.signal ? { signal: input.signal } : {}),
  };
  if (input.args.url !== undefined) action.url = input.args.url;
  if (input.args.targetId !== undefined) action.targetId = input.args.targetId;
  if (input.args.x !== undefined) action.x = input.args.x;
  if (input.args.y !== undefined) action.y = input.args.y;
  if (input.args.text !== undefined) action.text = input.args.text;
  if (input.args.key !== undefined) action.key = input.args.key;
  if (input.args.revision !== undefined) action.revision = input.args.revision;
  if (input.args.surfaceId !== undefined) action.surfaceId = input.args.surfaceId;
  return (deps.runtime ?? browserRuntime).execute(action);
}
