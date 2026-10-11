import type { ContextMessage } from '../shared/types.js';
import type { TokenUsage } from '../shared/llm-bridge.js';
import type { ToolPreparationProgress } from '../shared/tool-progress.js';
import type { SandboxLevel } from '../shared/sandbox-prompt.js';
import type { ToolDef } from '../shared/tool-defs-loader.js';
import type { FrameworkErrorKind } from '../shared/framework-error.js';
import type { ConversationInputEvent } from './input-runtime.js';
import type { DelegateToolEvent } from './delegate-tool.js';
import type { SessionToolExtension } from './session-tool-dispatcher.js';
import type { TeamHandoff } from './team/handoff.js';
import type { LLMCaller } from '../shared/react/native-loop.js';

export type ConversationEvent =
  | ConversationInputEvent
  | DelegateToolEvent
  | { type: 'token'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'heartbeat'; phase: 'llm-waiting' | 'tool-exec'; elapsed: number }
  | ({ type: 'tool-progress' } & ToolPreparationProgress)
  | { type: 'tool-call'; tool: string; args: Record<string, string> }
  | { type: 'tool-result'; tool: string; result: string; ok: boolean; meta?: unknown }
  | { type: 'ask'; question: string; options?: string[] }
  | { type: 'answer'; content: string; rawContent: string;
      native?: boolean; nativeContext?: ContextMessage[] }
  | { type: 'usage'; usage: TokenUsage | null }
  | { type: 'error'; message: string; code?: string; kind?: FrameworkErrorKind }
  | { type: 'notice'; message: string }
  | { type: 'compaction-notice'; message: string }
  | { type: 'context-compacted'; revision: number; marker: {
      id: string; role: 'system'; content: string; timestamp: string;
      type: 'compact-marker'; contextExact: true; nativeContext: Array<
        Omit<ContextMessage, 'images'> & { images?: Array<{
          id: string; name: string;
          mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; size: number;
        }> }> } }
  | { type: 'done' };

export interface SessionRunnerOpts {
  mainAgent?: boolean;
  extension?: SessionToolExtension & { createHandoff?: () => TeamHandoff };
  memberTools?: string[];
  maxTurns?: number;
  checkpoint?: (messages: ContextMessage[]) => Promise<void>;
  /** Owner-supplied model boundary. Shared runners never import a feature's persistence. */
  llmTransform?: (llm: LLMCaller, emit: (event: ConversationEvent) => void,
    rebase: (next: ContextMessage[]) => void) => LLMCaller;
  dataDir: string;
  agentId: string;
  model: string;
  temperature: number;
  toolNames: string[];
  toolMode?: 'all' | 'selected';
  skillIds: string[];
  workspace: string;
  sandboxLevel: SandboxLevel;
  sessionId?: string;
  signal?: AbortSignal;
  interceptTool?: (tool: string, args: Record<string, string>) => string | null;
  native?: boolean;
  allowAsk?: boolean;
  allowDelegate?: boolean;
}
