import { loadAgentToolDefs, type ToolDef } from '../shared/tool-defs-loader.js';
import { buildMemoryToolDefs } from '../shared/agent-memory.js';
import {
  buildBackgroundExecutionToolDefs, withBackgroundExecutionGuidance,
} from '../shared/background-execution-tools.js';
import { buildVirtualToolDefs } from './virtual-tools.js';
import { withMainToolGuidance } from './main-tool-defs.js';
import type { SessionRunnerOpts } from './session-runner-contracts.js';

export interface SessionToolAssemblyInput {
  loaded: ToolDef[];
  interactive: boolean;
  mainAgent: boolean;
  allowAsk?: boolean;
  allowDelegate?: boolean;
  memberTools?: string[];
  extensionTools?: ToolDef[];
}

export function assembleSessionToolDefs(input: SessionToolAssemblyInput): ToolDef[] {
  const local = input.interactive
    ? withBackgroundExecutionGuidance(input.loaded) : input.loaded;
  const assembled = [
    ...local,
    ...buildVirtualToolDefs(input.interactive, {
      allowAsk: input.allowAsk,
      allowDelegate: input.allowDelegate,
      allowFrameworkStatus: input.mainAgent && input.interactive,
    }).filter(tool => input.interactive || tool.name !== 'task_board'),
    ...(input.interactive ? buildBackgroundExecutionToolDefs() : []),
    ...buildMemoryToolDefs(),
    ...(input.extensionTools ?? []),
  ].filter(tool => !input.memberTools || input.memberTools.includes(tool.name));
  return input.mainAgent && input.interactive ? withMainToolGuidance(assembled) : assembled;
}

export function assembleSessionToolSets(
  input: SessionToolAssemblyInput & { guideExtensionTools?: ToolDef[] },
): { runtime: ToolDef[]; guide: ToolDef[] } {
  const runtime = assembleSessionToolDefs(input);
  if (!input.guideExtensionTools) return { runtime, guide: runtime };
  const guide = assembleSessionToolDefs({
    ...input,
    extensionTools: input.guideExtensionTools,
  });
  return { runtime, guide };
}

/** Shared catalog source for prompt construction and the conversation loop. */
export async function loadSessionToolSets(
  options: SessionRunnerOpts,
): Promise<{ runtime: ToolDef[]; guide: ToolDef[] }> {
  const loaded = await loadAgentToolDefs(
    options.dataDir, options.toolNames, options.skillIds, options.toolMode,
  );
  return assembleSessionToolSets({
    loaded, interactive: !!options.sessionId, mainAgent: !!options.mainAgent,
    allowAsk: options.allowAsk, allowDelegate: options.allowDelegate,
    memberTools: options.memberTools, extensionTools: options.extension?.definitions,
    guideExtensionTools: options.extension?.guideDefinitions,
  });
}
